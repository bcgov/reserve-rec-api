"use strict";

// Real data-utils, transactions configs, Worldline client and condition-failure detection;
// only DynamoDB, Secrets Manager and HTTP are doubled.
process.env.PAYMENTS_API_SECRET = "/secrets/paymentsApiPasscode";
process.env.MERCHANT_ID_SECRET = "/secrets/merchantId";
process.env.WORLDLINE_PAYMENT_API_URL = "https://api.na.bambora.com/v1/payments";

jest.mock("axios");
jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: "secret-value" }),
  })),
  GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, options) {
    this.message = message;
    this.code = options?.code;
    this.data = options?.data || null;
    this.error = options?.error || null;
  }),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getNowISO: jest.fn(() => "2026-06-11T12:00:00.000Z"),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  getOne: jest.fn(),
  getOneByGlobalId: jest.fn(),
  isConditionFailure: jest.requireActual("../../src/layers/awsUtils/dynamodb.js").isConditionFailure,
  marshall: jest.fn((value) => value),
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

const axios = require("axios");
const { logger } = require("/opt/base");
const { batchTransactData, getOne, getOneByGlobalId } = require("/opt/dynamodb");
const {
  MAX_PAYMENT_ATTEMPTS,
  acquirePaymentLock,
  assertPaymentAllowed,
  reconcilePayment,
  settlePaymentAttempt,
  settlePaymentManually,
  transitionPaymentAttempt,
  voidPaymentAttempt,
} = require("../../src/handlers/transactions/payment-attempts");

const conditionFailed = Object.assign(new Error("Transaction cancelled"), {
  name: "TransactionCanceledException",
  CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
});

function newAttempt(id = "BCPR-attempt-1") {
  return {
    pk: "transaction::booking-1",
    sk: `2026-06-11::${id}`,
    amount: 12.5,
    bookingId: "booking-1",
    clientTransactionId: id,
    date: "2026-06-11",
    globalId: id,
    schema: "transaction",
    sessionId: "session-1",
    status: "in progress",
    userId: "user-1",
    source: "public",
    statusHistory: [{ status: "in progress", at: "2026-06-11T12:00:00.000Z", source: "public" }],
  };
}

const heldBooking = { pk: "booking::user-1", sk: "2026-06-11::booking-1" };
const opsOf = (call) => batchTransactData.mock.calls[call][0];
const lockOp = (ops) => ops.find((op) => op.data.Key?.sk === "payment");

beforeEach(() => {
  jest.clearAllMocks();
  batchTransactData.mockResolvedValue(true);
  getOne.mockResolvedValue(null);
});

describe("acquirePaymentLock", () => {
  it("takes the lock and writes the PENDING attempt in one transaction", async () => {
    await acquirePaymentLock(newAttempt(), null, heldBooking);

    expect(batchTransactData).toHaveBeenCalledTimes(1);
    const ops = opsOf(0);
    const lock = lockOp(ops);
    expect(lock.data.Key).toEqual({ pk: "transaction::booking-1", sk: "payment" });
    expect(lock.data.ConditionExpression).toBe(
      "attribute_not_exists(pk) OR ((#status = :failed OR #status = :void) AND attemptCount = :previousAttemptCount)",
    );
    expect(lock.data.UpdateExpression).toContain("ADD attemptCount :one");
    expect(lock.data.ExpressionAttributeValues).toMatchObject({
      ":pending": "in progress",
      ":id": "BCPR-attempt-1",
      ":previousAttemptCount": 0,
    });
    const put = ops.find((op) => op.action === "Put");
    expect(put.data.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    expect(put.data.Item).toMatchObject({ status: "in progress", attemptNumber: 1, source: "public" });
  });

  it("retries after a failed attempt as the next attempt number, conditioned on the count it read", async () => {
    const attempt = newAttempt("BCPR-attempt-2");
    await acquirePaymentLock(attempt, { status: "failed", attemptCount: 1 }, heldBooking);

    const ops = opsOf(0);
    expect(lockOp(ops).data.ExpressionAttributeValues[":previousAttemptCount"]).toBe(1);
    expect(ops.find((op) => op.action === "Put").data.Item).toMatchObject({
      attemptNumber: 2,
      clientTransactionId: "BCPR-attempt-2",
    });
  });

  it("refuses the request that loses the race with 409 duplicate_payment and counts it on the lock", async () => {
    batchTransactData.mockRejectedValueOnce(conditionFailed);
    getOne.mockResolvedValue({ status: "in progress", attemptCount: 1, activeClientTransactionId: "BCPR-winner" });

    const err = await acquirePaymentLock(newAttempt(), null, heldBooking).catch((e) => e);

    expect(err.code).toBe(409);
    expect(err.data).toMatchObject({
      refusal: "duplicate_payment",
      paymentStatus: "in progress",
      clientTransactionId: "BCPR-winner",
    });
    const counter = opsOf(1)[0];
    expect(counter.data.UpdateExpression).toBe("SET lastDuplicateAt = :now ADD duplicateAttempts :one");
    expect(counter.data.ConditionExpression).toBe("attribute_exists(pk)");
  });

  it("takes the lock only while the booking's hold is live, without changing its expiry", async () => {
    await acquirePaymentLock(newAttempt(), null, heldBooking);

    const check = opsOf(0).find((op) => op.action === "ConditionCheck");
    expect(check.data.Key).toEqual({ pk: heldBooking.pk, sk: heldBooking.sk });
    expect(check.data.ConditionExpression).toBe(
      "attribute_exists(isPending) AND #status = :inProgress AND (attribute_not_exists(sessionExpiry) OR sessionExpiry > :now)",
    );
    expect(opsOf(0).some((op) => op.data.UpdateExpression?.includes("sessionExpiry"))).toBe(false);
  });

  it("refuses with 410 when the hold expired or was released before the lock", async () => {
    batchTransactData.mockRejectedValueOnce(Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }],
    }));

    await expect(acquirePaymentLock(newAttempt(), null, heldBooking)).rejects.toMatchObject({ code: 410 });
    expect(getOne).not.toHaveBeenCalled();
  });

  it("passes on a DynamoDB error that is not a failed condition", async () => {
    batchTransactData.mockRejectedValueOnce(new Error("throttled"));

    await expect(acquirePaymentLock(newAttempt(), null, heldBooking)).rejects.toThrow("throttled");
    expect(getOne).not.toHaveBeenCalled();
  });
});

describe("assertPaymentAllowed", () => {
  it.each([
    ["no lock yet", null],
    ["a failed attempt under the cap", { status: "failed", attemptCount: MAX_PAYMENT_ATTEMPTS - 1 }],
    ["a voided attempt under the cap", { status: "void", attemptCount: MAX_PAYMENT_ATTEMPTS - 1 }],
  ])("allows a payment with %s", async (_label, lock) => {
    await expect(assertPaymentAllowed("booking-1", lock)).resolves.toBeUndefined();
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ["in progress", "A payment for this booking is already being processed"],
    ["unknown", "A payment for this booking is already being processed"],
    ["paid", "Booking has already been paid"],
  ])("refuses a lock in '%s' with 409 duplicate_payment", async (status, message) => {
    const err = await assertPaymentAllowed("booking-1", { status, attemptCount: 1 }).catch((e) => e);

    expect(err).toMatchObject({ code: 409, message, data: { refusal: "duplicate_payment", paymentStatus: status } });
    expect(opsOf(0)[0].data.UpdateExpression).toContain("ADD duplicateAttempts :one");
  });

  it.each(["failed", "void"])("refuses the attempt after a '%s' one at the cap with 409 payment_attempts_exhausted", async (status) => {
    const err = await assertPaymentAllowed("booking-1", {
      status,
      attemptCount: MAX_PAYMENT_ATTEMPTS,
    }).catch((e) => e);

    expect(MAX_PAYMENT_ATTEMPTS).toBe(5);
    expect(err).toMatchObject({ code: 409, data: { refusal: "payment_attempts_exhausted", attemptCount: 5 } });
  });
});

describe("transitionPaymentAttempt", () => {
  const bookingUpdate = { action: "Update", data: { Key: { pk: "booking::x", sk: "booking-1" } } };

  it("moves attempt and lock from PENDING to SUCCESS together with the booking update", async () => {
    await transitionPaymentAttempt({
      attempt: newAttempt(),
      from: "in progress",
      to: "paid",
      source: "public",
      fields: { trnId: "10000123", cardType: undefined },
      history: { providerTrnId: "10000123" },
      extraOps: [bookingUpdate],
    });

    const [attemptOp, lock, booking] = opsOf(0);
    expect(attemptOp.data.Key).toEqual({ pk: "transaction::booking-1", sk: "2026-06-11::BCPR-attempt-1" });
    expect(attemptOp.data.ConditionExpression).toBe("#status = :expectedStatus");
    expect(attemptOp.data.ExpressionAttributeValues[":expectedStatus"]).toBe("in progress");
    expect(attemptOp.data.UpdateExpression).toContain("#statusHistory = list_append(");
    expect(attemptOp.data.ExpressionAttributeValues[":statusHistory"]).toEqual([
      { status: "paid", at: "2026-06-11T12:00:00.000Z", source: "public", providerTrnId: "10000123" },
    ]);
    expect(Object.values(attemptOp.data.ExpressionAttributeNames)).not.toContain("cardType");
    expect(lock.data.ConditionExpression).toBe("#status = :from AND activeClientTransactionId = :id");
    expect(lock.data.ExpressionAttributeValues).toMatchObject({
      ":from": "in progress",
      ":to": "paid",
      ":successfulClientTransactionId": "BCPR-attempt-1",
    });
    expect(booking).toBe(bookingUpdate);
  });

  it("sets no successful transaction on the lock for a failed attempt", async () => {
    await transitionPaymentAttempt({ attempt: newAttempt(), from: "in progress", to: "failed", source: "public" });

    expect(lockOp(opsOf(0)).data.UpdateExpression).not.toContain("successfulClientTransactionId");
  });
});

describe("settlePaymentAttempt", () => {
  it("reports a failed write instead of throwing it", async () => {
    batchTransactData.mockRejectedValueOnce(conditionFailed);

    await expect(
      settlePaymentAttempt({ attempt: newAttempt(), from: "in progress", to: "unknown", source: "public" }),
    ).resolves.toBe(false);
  });
});

describe("voidPaymentAttempt", () => {
  const voidArgs = () => ({ attempt: newAttempt(), trnId: "10000123", amount: 12.5, source: "public" });

  it("voids the exact amount under its own order number and moves attempt and lock from paid to void", async () => {
    axios.post.mockResolvedValue({ data: { id: "10000124", approved: "1", message: "Approved", type: "VP" } });

    await expect(voidPaymentAttempt(voidArgs())).resolves.toBe(true);

    const [url, payload, options] = axios.post.mock.calls[0];
    expect(url).toBe("https://api.na.bambora.com/v1/payments/10000123/void");
    expect(payload).toEqual({ amount: 12.5, order_number: "BCPV-attempt-1" });
    expect(options.headers.Authorization).toMatch(/^Passcode /);
    const [attemptOp, lock] = opsOf(0);
    expect(attemptOp.data.ExpressionAttributeValues).toMatchObject({
      ":status": "void",
      ":expectedStatus": "paid",
      ":needsReconciliation": false,
    });
    expect(attemptOp.data.ExpressionAttributeValues[":statusHistory"][0]).toMatchObject({
      status: "void",
      providerTrnId: "10000124",
    });
    expect(lock.data.ExpressionAttributeValues).toMatchObject({
      ":from": "paid",
      ":to": "void",
      ":needsReconciliation": false,
    });
  });

  it.each([
    ["a refusal after end of day (205)", () => axios.post.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 402"), {
        response: { status: 402, data: { code: 205, message: "Transaction only voidable on the date processed" } },
      }),
    )],
    ["a declined void", () => axios.post.mockResolvedValue({ data: { id: "10000124", approved: "0", message: "Declined" } })],
    ["no response", () => axios.post.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }))],
  ])("leaves the charge paid and logs payment_void_failed on %s", async (_label, arrange) => {
    arrange();

    await expect(voidPaymentAttempt(voidArgs())).resolves.toBe(false);

    expect(batchTransactData).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("event=payment_void_failed", expect.objectContaining({ trnId: "10000123" }));
  });
});

// Refunds read booking.clientTransactionId, so every settle to paid writes it.
const bookingLink = {
  action: "Update",
  data: expect.objectContaining({
    Key: { pk: "booking::user-1", sk: "2026-06-11::booking-1" },
    UpdateExpression: "SET clientTransactionId = :id",
    ExpressionAttributeValues: { ":id": "BCPR-attempt-1" },
  }),
};

describe("reconcilePayment", () => {
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const stuckLock = (overrides = {}) => ({
    pk: "transaction::booking-1",
    sk: "payment",
    status: "unknown",
    attemptCount: 1,
    activeClientTransactionId: "BCPR-attempt-1",
    pendingSince: "2026-06-11T12:00:00.000Z",
    ...overrides,
  });
  const searchResult = (records) => ({ data: { records } });
  const reconciledEvent = () => logger.info.mock.calls.find(([event]) => event === "event=payment_reconciled")?.[1];

  beforeEach(() => {
    process.env.REPORTING_API_SECRET = "/secrets/reportingApiPasscode";
    getOne.mockResolvedValue(stuckLock());
    getOneByGlobalId.mockResolvedValue(newAttempt());
  });

  afterAll(() => {
    delete process.env.REPORTING_API_SECRET;
  });

  it("searches the order number a day either side of pendingSince, then reads the payment by its trn id", async () => {
    axios.post.mockResolvedValue(searchResult([{ trn_id: 10000123 }]));
    axios.get.mockResolvedValue({ data: { id: "10000123", approved: 1, message: "Approved" } });

    await reconcilePayment("booking-1");

    const [url, query] = axios.post.mock.calls[0];
    expect(url).toBe("https://api.na.bambora.com/v1/reports");
    expect(query).toEqual({
      name: "Search",
      start_date: "2026-06-10T12:00:00",
      end_date: "2026-06-12T12:00:00",
      start_row: "1",
      end_row: "2",
      criteria: [
        { field: "5", operator: "%3D", value: "BCPR-attempt-1" },
        { field: "8", operator: "%3D", value: "P" },
      ],
    });
    expect(axios.get.mock.calls[0][0]).toBe("https://api.na.bambora.com/v1/payments/10000123");
  });

  it("records an approved payment as paid, flagged for reconciliation, without completing the booking", async () => {
    axios.post.mockResolvedValue(searchResult([{ trn_id: 10000123, trn_response: 0 }]));
    axios.get.mockResolvedValue({ data: { id: "10000123", approved: 1, message: "Approved" } });

    getOneByGlobalId.mockResolvedValueOnce(newAttempt()).mockResolvedValueOnce(heldBooking);

    const { lock } = await reconcilePayment("booking-1");

    expect(lock.status).toBe("paid");
    const ops = opsOf(0);
    expect(ops).toHaveLength(3);
    expect(ops[2]).toEqual(bookingLink);
    expect(lockOp(ops).data.ConditionExpression).toBe("#status = :from AND activeClientTransactionId = :id");
    expect(lockOp(ops).data.ExpressionAttributeValues).toMatchObject({
      ":from": "unknown",
      ":to": "paid",
      ":needsReconciliation": true,
    });
    expect(ops[0].data.ExpressionAttributeValues).toMatchObject({ ":status": "paid", ":trnId": "10000123" });
    expect(reconciledEvent()).toMatchObject({ outcome: "approved", settled: true });
  });

  it("records a declined payment as failed, so a new attempt may proceed", async () => {
    axios.post.mockResolvedValue(searchResult([{ trn_id: 10000123 }]));
    axios.get.mockResolvedValue({ data: { id: "10000123", approved: 0, message: "DECLINE" } });

    const { lock } = await reconcilePayment("booking-1");

    expect(lockOp(opsOf(0)).data.ExpressionAttributeValues).toMatchObject({ ":from": "unknown", ":to": "failed" });
    await expect(assertPaymentAllowed("booking-1", lock)).resolves.toBeUndefined();
    expect(reconciledEvent()).toMatchObject({ outcome: "declined" });
  });

  it("records an attempt Worldline has no record of after 31 minutes as failed", async () => {
    getOne.mockResolvedValue(stuckLock({ pendingSince: minutesAgo(31) }));
    axios.post.mockResolvedValue(searchResult([]));

    const { lock } = await reconcilePayment("booking-1");

    expect(lock.status).toBe("failed");
    expect(axios.get).not.toHaveBeenCalled();
    expect(lockOp(opsOf(0)).data.ExpressionAttributeValues[":to"]).toBe("failed");
    expect(reconciledEvent()).toMatchObject({ outcome: "not_found" });
  });

  it("leaves the lock as it was when an attempt 10 minutes old has no record yet", async () => {
    getOne.mockResolvedValue(stuckLock({ pendingSince: minutesAgo(10) }));
    axios.post.mockResolvedValue(searchResult([]));

    const { lock } = await reconcilePayment("booking-1");

    expect(lock.status).toBe("unknown");
    expect(batchTransactData).not.toHaveBeenCalled();
    expect(reconciledEvent()).toMatchObject({ outcome: "not_found_waiting" });
  });

  it("leaves the lock as it was when the lookup fails, so the duplicate refusal stands", async () => {
    axios.post.mockRejectedValue(Object.assign(new Error("Unauthorized"), { response: { status: 401, data: {} } }));

    const { lock } = await reconcilePayment("booking-1");

    expect(lock.status).toBe("unknown");
    expect(batchTransactData).not.toHaveBeenCalled();
    expect(reconciledEvent()).toMatchObject({ outcome: "lookup_failed" });
    await expect(assertPaymentAllowed("booking-1", lock)).rejects.toMatchObject({ code: 409 });
  });

  it("skips the lookup when no Reporting API passcode is configured", async () => {
    process.env.REPORTING_API_SECRET = "";

    const { lock } = await reconcilePayment("booking-1");

    expect(lock.status).toBe("unknown");
    expect(axios.post).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
    expect(reconciledEvent()).toMatchObject({ outcome: "skipped" });
  });

  it.each([
    [4, 0],
    [6, 1],
  ])("looks up an in-progress lock pending for %i minutes %i time(s)", async (minutes, lookups) => {
    getOne.mockResolvedValue(stuckLock({ status: "in progress", pendingSince: minutesAgo(minutes) }));
    axios.post.mockResolvedValue(searchResult([]));

    await reconcilePayment("booking-1");

    expect(axios.post).toHaveBeenCalledTimes(lookups);
  });
});

describe("settlePaymentManually", () => {
  const stuckLock = (overrides = {}) => ({
    pk: "transaction::booking-1",
    sk: "payment",
    status: "unknown",
    attemptCount: 1,
    activeClientTransactionId: "BCPR-attempt-1",
    pendingSince: "2026-06-11T12:00:00.000Z",
    ...overrides,
  });
  const ruling = (overrides = {}) => ({ status: "failed", reason: "No charge in Worldline", adminId: "admin-1", ...overrides });

  beforeEach(() => {
    getOne.mockResolvedValue(stuckLock());
    getOneByGlobalId.mockResolvedValue(newAttempt());
  });

  it("marks a stuck payment failed without asking Worldline, so a new attempt may proceed", async () => {
    const { lock } = await settlePaymentManually("booking-1", ruling());

    expect(axios.post).not.toHaveBeenCalled();
    const ops = opsOf(0);
    expect(lockOp(ops).data.ExpressionAttributeValues).toMatchObject({ ":from": "unknown", ":to": "failed" });
    expect(ops[0].data.ExpressionAttributeValues[":statusHistory"]).toEqual([
      expect.objectContaining({ status: "failed", source: "admin", adminId: "admin-1", reason: "No charge in Worldline" }),
    ]);
    await expect(assertPaymentAllowed("booking-1", lock)).resolves.toBeUndefined();
  });

  it("marks a stuck payment paid, flagged for reconciliation, and links the booking to it", async () => {
    getOneByGlobalId.mockResolvedValueOnce(newAttempt()).mockResolvedValueOnce(heldBooking);

    const { lock } = await settlePaymentManually("booking-1", ruling({ status: "paid" }));

    expect(lock).toMatchObject({ status: "paid", needsReconciliation: true });
    expect(lockOp(opsOf(0)).data.ExpressionAttributeValues).toMatchObject({ ":to": "paid", ":needsReconciliation": true });
    expect(opsOf(0)[2]).toEqual(bookingLink);
  });

  it.each([
    ["a status other than failed or paid", { status: "void" }],
    ["no reason", { reason: "  " }],
  ])("refuses %s with 400 before reading the lock", async (_, overrides) => {
    await expect(settlePaymentManually("booking-1", ruling(overrides))).rejects.toMatchObject({ code: 400 });
    expect(getOne).not.toHaveBeenCalled();
  });

  it.each([
    ["paid", stuckLock({ status: "paid" })],
    ["in progress for 1 minute", stuckLock({ status: "in progress", pendingSince: new Date(Date.now() - 60 * 1000).toISOString() })],
  ])("refuses a lock that is %s with 409", async (_, lock) => {
    getOne.mockResolvedValue(lock);

    await expect(settlePaymentManually("booking-1", ruling())).rejects.toMatchObject({ code: 409 });
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it("refuses with 409 when another request settled the lock first", async () => {
    batchTransactData.mockRejectedValue(conditionFailed);

    await expect(settlePaymentManually("booking-1", ruling())).rejects.toMatchObject({ code: 409 });
  });

  it("returns no lock for a booking that has none", async () => {
    getOne.mockResolvedValue(null);

    await expect(settlePaymentManually("booking-1", ruling())).resolves.toEqual({ lock: null, attempt: null });
  });
});
