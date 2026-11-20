"use strict";

// One payment per booking: a lock item at {transaction::<bookingId>, payment} is moved
// through the payment states with conditional writes, alongside the attempt row it points at.
const { Exception, getNowISO, logger } = require("/opt/base");
const {
  batchTransactData,
  getOne,
  getOneByGlobalId,
  isConditionFailure,
  marshall,
  TRANSACTIONAL_DATA_TABLE_NAME,
} = require("/opt/dynamodb");
const {
  quickApiPutHandler,
  quickApiUpdateHandler,
} = require("../../common/data-utils");
const {
  TRANSACTION_PUT_CONFIG,
  TRANSACTION_UPDATE_CONFIG,
} = require("./configs");
const { BOOKING_STATUSES, TRANSACTION_STATUSES } = require("../../common/data-constants");
const {
  canSearchPayments,
  findPaymentByOrderNumber,
  getPayment,
  isApproved,
  voidPayment,
} = require("./worldline-client");

const MAX_PAYMENT_ATTEMPTS = 5;
const PAYMENT_LOCK_SK = "payment";
// An attempt still PENDING after this long lost its request (Lambda killed mid-charge).
const STALE_PENDING_MS = 5 * 60 * 1000;
// Search may not list a fresh charge at once, so "no record" frees the lock only after this long.
const NOT_FOUND_SETTLE_MS = 30 * 60 * 1000;
// Statuses whose attempt is over with no money kept, so the booking may be paid again.
const RETRYABLE_STATUSES = [TRANSACTION_STATUSES.FAILED, TRANSACTION_STATUSES.VOIDED];
const PAYMENT_REFUSALS = {
  DUPLICATE: "duplicate_payment",
  ATTEMPTS_EXHAUSTED: "payment_attempts_exhausted",
  UNCONFIRMED: "payment_unconfirmed",
};

function paymentLockKey(bookingId) {
  return { pk: `transaction::${bookingId}`, sk: PAYMENT_LOCK_SK };
}

function withoutUndefined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  );
}

function historyEntry(status, source, details = {}) {
  return withoutUndefined({ status, at: getNowISO(), source, ...details });
}

async function getPaymentLock(bookingId) {
  const { pk, sk } = paymentLockKey(bookingId);
  return getOne(pk, sk, TRANSACTIONAL_DATA_TABLE_NAME);
}

/** Best effort: a refused duplicate is counted on the lock, never blocks the refusal. */
async function recordDuplicateAttempt(bookingId) {
  logger.info("event=payment_duplicate_refused", { bookingId });
  try {
    await batchTransactData([
      {
        action: "Update",
        data: {
          TableName: TRANSACTIONAL_DATA_TABLE_NAME,
          Key: marshall(paymentLockKey(bookingId)),
          UpdateExpression:
            "SET lastDuplicateAt = :now ADD duplicateAttempts :one",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: marshall({ ":now": getNowISO(), ":one": 1 }),
        },
      },
    ]);
  } catch (error) {
    logger.warn("Could not count duplicate payment attempt", {
      bookingId,
      error: error?.message,
    });
  }
}

/** The 409 for a booking whose lock does not allow another attempt. */
async function paymentRefusal(bookingId, lock) {
  const attemptCount = lock?.attemptCount ?? 0;
  if (RETRYABLE_STATUSES.includes(lock?.status) && attemptCount >= MAX_PAYMENT_ATTEMPTS) {
    logger.info("event=payment_attempts_exhausted", { bookingId, attemptCount });
    return new Exception("This booking has reached its payment attempt limit", {
      code: 409,
      data: { refusal: PAYMENT_REFUSALS.ATTEMPTS_EXHAUSTED, bookingId, attemptCount },
    });
  }
  await recordDuplicateAttempt(bookingId);
  const paid = lock?.status === TRANSACTION_STATUSES.SUCCESS;
  return new Exception(
    paid
      ? "Booking has already been paid"
      : "A payment for this booking is already being processed",
    {
      code: 409,
      data: {
        refusal: PAYMENT_REFUSALS.DUPLICATE,
        bookingId,
        paymentStatus: lock?.status ?? null,
        clientTransactionId: lock?.activeClientTransactionId ?? null,
      },
    },
  );
}

/** Throws the 409 unless the booking has no lock or its last attempt failed or was voided under the cap. */
async function assertPaymentAllowed(bookingId, lock) {
  if (!lock) return;
  if (RETRYABLE_STATUSES.includes(lock.status) && (lock.attemptCount ?? 0) < MAX_PAYMENT_ATTEMPTS) {
    return;
  }
  throw await paymentRefusal(bookingId, lock);
}

// A payment may start only on a hold that is still live; once it has, the expiry scraper leaves
// the booking alone until the lock is failed or void (incompleteBookingScraper).
function bookingStillHeldCheck(booking, now = Date.now()) {
  return {
    action: "ConditionCheck",
    data: {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: marshall({ pk: booking.pk, sk: booking.sk }),
      ConditionExpression:
        "attribute_exists(isPending) AND #status = :inProgress AND (attribute_not_exists(sessionExpiry) OR sessionExpiry > :now)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: marshall({ ":inProgress": BOOKING_STATUSES.IN_PROGRESS, ":now": now }),
    },
  };
}

// Takes the lock with the PENDING attempt row; the write requires the lock unchanged since
// `lock` was read, so of two concurrent requests exactly one gets to charge.
async function acquirePaymentLock(attempt, lock, booking) {
  const previousAttemptCount = lock?.attemptCount ?? 0;
  attempt.attemptNumber = previousAttemptCount + 1;
  const now = getNowISO();

  const lockOp = {
    action: "Update",
    data: {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: marshall(paymentLockKey(attempt.bookingId)),
      UpdateExpression:
        "SET #status = :pending, #schema = :schema, bookingId = :bookingId, userId = :userId, " +
        "activeClientTransactionId = :id, pendingSince = :now, lastUpdated = :now " +
        "ADD attemptCount :one",
      ConditionExpression:
        "attribute_not_exists(pk) OR ((#status = :failed OR #status = :void) AND attemptCount = :previousAttemptCount)",
      ExpressionAttributeNames: { "#status": "status", "#schema": "schema" },
      ExpressionAttributeValues: marshall({
        ":pending": TRANSACTION_STATUSES.PENDING,
        ":failed": TRANSACTION_STATUSES.FAILED,
        ":void": TRANSACTION_STATUSES.VOIDED,
        ":schema": "paymentLock",
        ":bookingId": attempt.bookingId,
        ":userId": attempt.userId,
        ":id": attempt.clientTransactionId,
        ":now": now,
        ":one": 1,
        ":previousAttemptCount": previousAttemptCount,
      }),
    },
  };

  const attemptOps = await quickApiPutHandler(
    TRANSACTIONAL_DATA_TABLE_NAME,
    [
      {
        key: { pk: attempt.pk, sk: attempt.sk },
        data: withoutUndefined(attempt),
      },
    ],
    TRANSACTION_PUT_CONFIG,
  );

  const ops = [lockOp, ...attemptOps, bookingStillHeldCheck(booking)];
  try {
    await batchTransactData(ops);
  } catch (error) {
    if (!isConditionFailure(error)) throw error;
    if (error.CancellationReasons?.[ops.length - 1]?.Code === "ConditionalCheckFailed") {
      throw new Exception("Booking session has expired. Please create a new booking.", {
        code: 410,
        data: { bookingId: attempt.bookingId },
      });
    }
    throw await paymentRefusal(
      attempt.bookingId,
      await getPaymentLock(attempt.bookingId),
    );
  }
}

// Moves attempt and lock from `from` to `to` in one transaction; `extraOps` (the booking
// completion) commit or fail with them.
async function transitionPaymentAttempt({
  attempt,
  from,
  to,
  source,
  fields = {},
  lockFields = {},
  history = {},
  extraOps = [],
}) {
  const now = getNowISO();
  const [attemptOp] = await quickApiUpdateHandler(
    TRANSACTIONAL_DATA_TABLE_NAME,
    [
      {
        key: { pk: attempt.pk, sk: attempt.sk },
        data: {
          ...withoutUndefined(fields),
          status: to,
          statusHistory: {
            value: [historyEntry(to, source, history)],
            action: "append",
          },
        },
      },
    ],
    TRANSACTION_UPDATE_CONFIG,
  );
  attemptOp.data.ConditionExpression = "#status = :expectedStatus";
  attemptOp.data.ExpressionAttributeValues[":expectedStatus"] = marshall(from);

  const lockSet = {
    ...lockFields,
    ...(to === TRANSACTION_STATUSES.SUCCESS && {
      successfulClientTransactionId: attempt.clientTransactionId,
    }),
  };
  const setClauses = ["#status = :to", "lastUpdated = :now"].concat(
    Object.keys(lockSet).map((field) => `${field} = :${field}`),
  );
  const lockOp = {
    action: "Update",
    data: {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: marshall(paymentLockKey(attempt.bookingId)),
      UpdateExpression: `SET ${setClauses.join(", ")}`,
      ConditionExpression: "#status = :from AND activeClientTransactionId = :id",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: marshall({
        ":to": to,
        ":from": from,
        ":id": attempt.clientTransactionId,
        ":now": now,
        ...Object.fromEntries(
          Object.entries(lockSet).map(([field, value]) => [`:${field}`, value]),
        ),
      }),
    },
  };

  await batchTransactData([attemptOp, lockOp, ...extraOps]);
}

/** A transition whose failure must not hide the payment outcome from the caller. */
async function settlePaymentAttempt(transition) {
  try {
    await transitionPaymentAttempt(transition);
    return true;
  } catch (error) {
    logger.error("event=payment_record_failed", {
      bookingId: transition.attempt.bookingId,
      clientTransactionId: transition.attempt.clientTransactionId,
      to: transition.to,
      error: error?.message,
    });
    return false;
  }
}

/**
 * Voids an approved charge whose booking could not complete. The attempt and lock must already be
 * SUCCESS; on approval they move to VOIDED. Never throws.
 * @returns {Promise<boolean>} Whether Worldline approved the void.
 */
async function voidPaymentAttempt({ attempt, trnId, amount, source }) {
  const { bookingId, clientTransactionId } = attempt;
  let response;
  try {
    response = await voidPayment(trnId, amount);
  } catch (error) {
    response = error?.response?.data;
    logger.error("event=payment_void_failed", {
      bookingId,
      clientTransactionId,
      trnId,
      httpStatus: error?.response?.status,
      providerCode: response?.code,
      providerMessage: response?.message || error?.message,
    });
    return false;
  }
  if (!isApproved(response)) {
    logger.error("event=payment_void_failed", {
      bookingId,
      clientTransactionId,
      trnId,
      providerCode: response?.message_id,
      providerMessage: response?.message,
    });
    return false;
  }
  logger.info("event=payment_voided", { bookingId, clientTransactionId, voidTrnId: response.id });
  await settlePaymentAttempt({
    attempt,
    from: TRANSACTION_STATUSES.SUCCESS,
    to: TRANSACTION_STATUSES.VOIDED,
    source,
    fields: { needsReconciliation: false },
    lockFields: { needsReconciliation: false },
    history: { providerTrnId: String(response.id), providerMessage: response.message },
  });
  return true;
}

/** True for a lock whose outcome nobody will report: UNKNOWN, or PENDING past STALE_PENDING_MS. */
function isPaymentStuck(lock, now = Date.now()) {
  if (lock?.status === TRANSACTION_STATUSES.UNKNOWN) return true;
  return (
    lock?.status === TRANSACTION_STATUSES.PENDING &&
    now - Date.parse(lock.pendingSince) > STALE_PENDING_MS
  );
}

// Asks Worldline what happened to the lock's active attempt. Returns the provider transaction
// (null when it has none), or throws when the lookup cannot be made.
async function lookUpAttempt(lock) {
  const day = 24 * 60 * 60 * 1000;
  const pendingSince = Date.parse(lock.pendingSince);
  if (Number.isNaN(pendingSince)) throw new Error("Payment lock has no pendingSince");
  // The merchant timezone is unknown, so the window spans a day either side.
  const record = await findPaymentByOrderNumber(
    lock.activeClientTransactionId,
    new Date(pendingSince - day).toISOString(),
    new Date(pendingSince + day).toISOString(),
  );
  return record ? getPayment(record.trn_id) : null;
}

// Settles a stuck lock from Worldline's record; approved is only flagged, the booking is not completed here.
// Leaves the lock unchanged when the lookup is skipped or fails, and never throws for that.
// Refunds find the payment through booking.clientTransactionId, so settling to paid links it there.
async function bookingPaymentLinkOps(bookingId, clientTransactionId) {
  const booking = await getOneByGlobalId(bookingId, TRANSACTIONAL_DATA_TABLE_NAME, "globalId", "globalId-index");
  if (!booking) return [];
  return [{
    action: "Update",
    data: {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: marshall({ pk: booking.pk, sk: booking.sk }),
      UpdateExpression: "SET clientTransactionId = :id",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeValues: marshall({ ":id": clientTransactionId }),
    },
  }];
}

async function reconcilePayment(bookingId) {
  const lock = await getPaymentLock(bookingId);
  if (!isPaymentStuck(lock)) return { lock, attempt: null };

  const clientTransactionId = lock.activeClientTransactionId;
  const logOutcome = (outcome, extra = {}) =>
    logger.info("event=payment_reconciled", {
      bookingId,
      clientTransactionId,
      from: lock.status,
      outcome,
      ...extra,
    });

  if (!canSearchPayments()) {
    logOutcome("skipped");
    return { lock, attempt: null };
  }

  let attempt;
  let payment;
  try {
    attempt = await getOneByGlobalId(
      clientTransactionId,
      TRANSACTIONAL_DATA_TABLE_NAME,
      "globalId",
      "globalId-index",
    );
    if (!attempt) throw new Error("Active payment attempt not found");
    payment = await lookUpAttempt(lock);
  } catch (error) {
    logOutcome("lookup_failed", { error: error?.message });
    return { lock, attempt: attempt ?? null };
  }
  if (!payment && Date.now() - Date.parse(lock.pendingSince) <= NOT_FOUND_SETTLE_MS) {
    logOutcome("not_found_waiting");
    return { lock, attempt };
  }

  const approved = Boolean(payment) && isApproved(payment);
  const to = approved ? TRANSACTION_STATUSES.SUCCESS : TRANSACTION_STATUSES.FAILED;
  const flags = approved ? { needsReconciliation: true } : {};
  const providerFields = payment
    ? { trnId: String(payment.id), trnApproved: String(payment.approved), trnMessage: payment.message }
    : {};
  const settled = await settlePaymentAttempt({
    attempt,
    from: lock.status,
    to,
    source: "reconciliation",
    fields: { ...providerFields, ...flags },
    lockFields: flags,
    extraOps: approved ? await bookingPaymentLinkOps(bookingId, clientTransactionId) : [],
    history: {
      providerTrnId: providerFields.trnId,
      providerMessage: payment ? payment.message : "No Worldline record for the order number",
    },
  });
  const outcome = approved ? "approved" : payment ? "declined" : "not_found";
  logOutcome(outcome, { settled });
  if (!settled) return { lock: await getPaymentLock(bookingId), attempt };
  return {
    lock: { ...lock, ...flags, status: to },
    attempt: { ...attempt, ...providerFields, ...flags, status: to },
  };
}

// For when reconciliation cannot settle a stuck lock; `paid` is flagged like an approved lookup.
async function settlePaymentManually(bookingId, { status, reason, adminId }) {
  if (![TRANSACTION_STATUSES.FAILED, TRANSACTION_STATUSES.SUCCESS].includes(status)) {
    throw new Exception(`status must be "${TRANSACTION_STATUSES.FAILED}" or "${TRANSACTION_STATUSES.SUCCESS}"`, { code: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Exception("A reason is required to settle a payment by hand", { code: 400 });
  }
  const lock = await getPaymentLock(bookingId);
  if (!lock) return { lock: null, attempt: null };
  if (!isPaymentStuck(lock)) {
    throw new Exception("Only a stuck payment can be settled by hand", {
      code: 409,
      data: { bookingId, paymentStatus: lock.status },
    });
  }
  const clientTransactionId = lock.activeClientTransactionId;
  const attempt = await getOneByGlobalId(
    clientTransactionId,
    TRANSACTIONAL_DATA_TABLE_NAME,
    "globalId",
    "globalId-index",
  );
  if (!attempt) {
    throw new Exception("The lock's payment attempt was not found", {
      code: 409,
      data: { bookingId, clientTransactionId },
    });
  }

  const flags = status === TRANSACTION_STATUSES.SUCCESS ? { needsReconciliation: true } : {};
  try {
    await transitionPaymentAttempt({
      attempt,
      from: lock.status,
      to: status,
      source: "admin",
      fields: flags,
      lockFields: flags,
      extraOps: status === TRANSACTION_STATUSES.SUCCESS ? await bookingPaymentLinkOps(bookingId, clientTransactionId) : [],
      history: { adminId, reason: reason.trim() },
    });
  } catch (error) {
    if (!isConditionFailure(error)) throw error;
    throw new Exception("The payment changed while it was being settled; check it again", {
      code: 409,
      data: { bookingId },
    });
  }
  logger.info("event=payment_settled_manually", {
    bookingId,
    clientTransactionId,
    from: lock.status,
    to: status,
    adminId,
  });
  return {
    lock: { ...lock, ...flags, status },
    attempt: { ...attempt, ...flags, status },
  };
}

module.exports = {
  MAX_PAYMENT_ATTEMPTS,
  NOT_FOUND_SETTLE_MS,
  PAYMENT_LOCK_SK,
  STALE_PENDING_MS,
  PAYMENT_REFUSALS,
  acquirePaymentLock,
  assertPaymentAllowed,
  getPaymentLock,
  historyEntry,
  isPaymentStuck,
  reconcilePayment,
  recordDuplicateAttempt,
  settlePaymentAttempt,
  settlePaymentManually,
  transitionPaymentAttempt,
  voidPaymentAttempt,
};
