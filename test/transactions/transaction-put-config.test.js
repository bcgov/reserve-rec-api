"use strict";

// Real data-utils + transactions configs; only Worldline, Secrets Manager and DynamoDB are doubled.
process.env.PAYMENTS_API_SECRET = "/secrets/paymentsApiPasscode";
process.env.MERCHANT_ID_SECRET = "/secrets/merchantId";
process.env.WORLDLINE_PAYMENT_API_URL = "https://api.na.bambora.com/v1/payments";
process.env.HASH_KEY_SECRET = "/secrets/hashKey";
process.env.WORLDLINE_PAYMENT_API_URL = "https://api.na.bambora.com/v1/payments";

jest.mock("axios");
const mockSecretsSend = jest.fn();
jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: mockSecretsSend,
  })),
  GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock("/opt/base", () => {
  const { DateTime } = require("luxon");
  return {
    DateTime,
    Exception: jest.fn(function (message, options) {
      this.message = message;
      this.code = options?.code;
      this.data = options?.data || null;
      this.error = options?.error || null;
    }),
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    getNow: jest.fn(() => DateTime.fromISO("2026-06-11T12:00:00Z", { zone: "UTC" })),
    getNowISO: jest.fn(() => "2026-06-11T12:00:00.000Z"),
  };
});

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  getOne: jest.fn(),
  getOneByGlobalId: jest.fn(),
  isConditionFailure: jest.requireActual("../../src/layers/awsUtils/dynamodb.js").isConditionFailure,
  putItem: jest.fn(),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
  marshall: jest.fn((value) => value),
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
  REFERENCE_DATA_TABLE_NAME: "ReferenceDataTable",
}));

jest.mock("../../src/handlers/bookings/methods", () => ({
  completeBooking: jest.fn(),
  sendBookingConfirmationEmail: jest.fn(),
}));

jest.mock("../../src/handlers/bookings/notifications", () => ({
  enqueueSmsReminderIfNeeded: jest.fn(),
}));

const axios = require("axios");
const { Exception } = require("/opt/base");
const { batchTransactData, getOne, getOneByGlobalId } = require("/opt/dynamodb");
const { completeBooking, sendBookingConfirmationEmail } = require("../../src/handlers/bookings/methods");
const { enqueueSmsReminderIfNeeded } = require("../../src/handlers/bookings/notifications");
const {
  processTokenTransaction,
  updateTransactionForPayment,
  updateTransactionForRefund,
} = require("../../src/handlers/transactions/methods");
const { quickApiUpdateHandler } = require("../../src/common/data-utils");
const { TRANSACTION_UPDATE_CONFIG } = require("../../src/handlers/transactions/configs");

// Shape of a Worldline REST payment response, as returned by api.na.bambora.com/v1/payments.
function worldlineResponse(overrides = {}) {
  return {
    id: "10000123",
    authorizing_merchant_id: 123456789,
    approved: "1",
    message_id: "1",
    message: "Approved",
    auth_code: "TEST",
    created: "2026-06-11T08:08:51",
    order_number: "BCPR-0b6a1c4e-5d0f-4a0e-9f",
    type: "P",
    payment_method: "CC",
    risk_score: 0,
    amount: 12.5,
    custom: { ref1: "booking-1", ref2: "session-1", ref3: "", ref4: "", ref5: "" },
    card: {
      card_type: "VI",
      last_four: "4675",
      card_bin: "433026",
      address_match: 0,
      postal_result: 0,
      avs_result: "0",
      cvd_result: "1",
      avs: { id: "U", message: "Address information is unavailable.", processed: false },
    },
    links: [{ rel: "void", href: "https://api.na.bambora.com/v1/payments/10000123/void", method: "POST" }],
    ...overrides,
  };
}

// completeBooking returns an already-built transact array, not a {key, data} item.
const bookingUpdate = {
  action: "Update",
  data: { TableName: "TransactionalDataTable", Key: { pk: "booking::x", sk: "2026-06-11::booking-1" }, UpdateExpression: "SET #status = :status" },
};

const body = {
  bookingId: "booking-1",
  sessionId: "session-1",
  token: "tok-1",
  cardholderName: "Jane Camper",
  // The same fields the free path sends to POST /bookings/{id}/complete.
  namedOccupant: { contactInfo: { postalCode: "V8V 1A1", city: "Victoria" } },
  vehicleInformation: [{ licensePlate: "ABC123", licensePlateRegistrationRegion: "BC" }],
  equipmentInformation: "tent",
  smsOptIn: true,
};

const conditionFailed = Object.assign(new Error("Transaction cancelled"), {
  name: "TransactionCanceledException",
  CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }],
});

// batchTransactData call 0 takes the lock with the PENDING attempt; call 1 settles it.
const writesOf = (call) => batchTransactData.mock.calls[call][0];
const lockWrite = (writes) => writes.find((w) => w.data.Key?.sk === "payment");
const attemptWrite = (writes) => writes.find((w) => w.data.Key?.sk?.startsWith("2026-06-11::BCPR-"));

describe("processTokenTransaction through the payment lock and TRANSACTION configs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOneByGlobalId.mockResolvedValue({
      bookingId: "booking-1",
      sessionId: "session-1",
      userId: "user-1",
      status: "in progress",
      feeValues: { bookingTotal: 12.5 },
    });
    getOne.mockResolvedValue(null);
    completeBooking.mockResolvedValue({
      updateRequests: [bookingUpdate],
      emailParams: { to: "jane@example.com" },
      smsParams: { smsOptIn: true, namedOccupant: { contactInfo: { mobilePhone: "+12505550100" } } },
      ownerIdentity: { email: "jane@example.com" },
    });
    batchTransactData.mockResolvedValue(true);
    mockSecretsSend.mockResolvedValue({ SecretString: "secret-value" });
  });

  it("does not charge when the hold expired between the booking check and the lock", async () => {
    batchTransactData.mockRejectedValueOnce(Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }],
    }));

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toMatchObject({ code: 410 });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("frees the lock as FAILED when the payment cannot be sent, without charging", async () => {
    const cachedPath = process.env.PAYMENTS_API_SECRET;
    process.env.PAYMENTS_API_SECRET = "/secrets/notYetCached";
    mockSecretsSend.mockRejectedValueOnce(new Error("AccessDenied"));

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toMatchObject({ code: 400 });
    process.env.PAYMENTS_API_SECRET = cachedPath;

    expect(axios.post).not.toHaveBeenCalled();
    expect(lockWrite(writesOf(1)).data.ExpressionAttributeValues[":to"]).toBe("failed");
  });

  it("writes the attempt PENDING before charging, then commits attempt, lock and booking update in one transaction", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse() });

    const result = await processTokenTransaction(body, "user-1", null);

    expect(result.status).toBe("paid");
    expect(batchTransactData).toHaveBeenCalledTimes(2);
    expect(batchTransactData.mock.invocationCallOrder[0]).toBeLessThan(axios.post.mock.invocationCallOrder[0]);
    const put = writesOf(0).find((w) => w.action === "Put");
    expect(put.data.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    expect(put.data.Item).toMatchObject({
      pk: "transaction::booking-1",
      schema: "transaction",
      status: "in progress",
      amount: 12.5,
      userId: "user-1",
      attemptNumber: 1,
      source: "public",
    });
    expect(put.data.Item.clientTransactionId).toHaveLength(30);

    const writes = writesOf(1);
    expect(writes).toHaveLength(3);
    const attempt = attemptWrite(writes);
    expect(attempt.data.ConditionExpression).toBe("#status = :expectedStatus");
    expect(attempt.data.ExpressionAttributeValues).toMatchObject({
      ":status": "paid",
      ":expectedStatus": "in progress",
      ":trnId": "10000123",
      ":cardLastFour": "4675",
    });
    expect(lockWrite(writes).data.ExpressionAttributeValues).toMatchObject({ ":from": "in progress", ":to": "paid" });
    expect(writes).toContainEqual(bookingUpdate);
  });

  it("sends the confirmation email and SMS once the paid booking is saved", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse() });

    await processTokenTransaction(body, "user-1", null);

    expect(sendBookingConfirmationEmail).toHaveBeenCalledWith({ to: "jane@example.com" }, "user-1", { email: "jane@example.com" });
    expect(enqueueSmsReminderIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ smsOptIn: true }),
      { bookingId: "booking-1" },
      "+12505550100",
    );
  });

  it("still answers paid when the confirmation email fails", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse() });
    sendBookingConfirmationEmail.mockRejectedValueOnce(new Error("EMAIL_QUEUE_URL environment variable not set"));

    const result = await processTokenTransaction(body, "user-1", null);

    expect(result.status).toBe("paid");
    expect(enqueueSmsReminderIfNeeded).toHaveBeenCalled();
  });

  it("completes the booking with the request's occupant fields and the payer's sub", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse() });

    await processTokenTransaction(body, "user-1", null);

    expect(completeBooking).toHaveBeenCalledWith(
      "booking-1",
      "session-1",
      expect.objectContaining({
        namedOccupant: body.namedOccupant,
        vehicleInformation: body.vehicleInformation,
        equipmentInformation: "tent",
        smsOptIn: true,
      }),
      { sub: "user-1", clientTransactionId: expect.stringMatching(/^BCPR-/) },
    );
    expect(completeBooking.mock.calls[0][2]).not.toHaveProperty("token");
  });

  it("charges the amount from the booking, not the request, with a timeout below the Lambda's", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse() });

    await processTokenTransaction({ ...body, trnAmount: 0.01 }, "user-1", null);

    const [, payload, options] = axios.post.mock.calls[0];
    expect(payload.amount).toBe(12.5);
    expect(options.timeout).toBeLessThan(10000);
  });

  it("falls back to the booking's own session and occupant details when the request leaves them out", async () => {
    const saved = { namedOccupant: { firstName: "Jane" }, vehicleInformation: [{ licensePlate: "ABC123" }], equipmentInformation: "van" };
    getOneByGlobalId.mockResolvedValue({ bookingId: "booking-1", sessionId: "session-1", userId: "user-1", status: "in progress", feeValues: { bookingTotal: 12.5 }, ...saved });
    axios.post.mockResolvedValue({ data: worldlineResponse() });
    const { sessionId, namedOccupant, vehicleInformation, equipmentInformation, ...bare } = body;

    await processTokenTransaction(bare, "user-1", null);

    expect(completeBooking).toHaveBeenCalledWith("booking-1", "session-1", expect.objectContaining(saved), expect.anything());
    expect(axios.post.mock.calls[0][1].custom.ref2).toBe("session-1");
  });

  it("charges the fee policy total ahead of feeValues, under the request's billing name", async () => {
    getOneByGlobalId.mockResolvedValue({
      bookingId: "booking-1", sessionId: "session-1", userId: "user-1", status: "in progress",
      feePolicySnapshot: { feeInformation: { total: 20 } }, feeValues: { bookingTotal: 12.5 },
    });
    axios.post.mockResolvedValue({ data: worldlineResponse() });

    await processTokenTransaction({ ...body, billingName: "Jane Alternate" }, "user-1", null);

    const [, payload] = axios.post.mock.calls[0];
    expect(payload.amount).toBe(20);
    expect(payload.billing.name).toBe("Jane Alternate");
  });

  it("frees the lock as FAILED without charging when the Worldline URL is not set", async () => {
    const url = process.env.WORLDLINE_PAYMENT_API_URL;
    delete process.env.WORLDLINE_PAYMENT_API_URL;

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toMatchObject({ code: 400 });
    process.env.WORLDLINE_PAYMENT_API_URL = url;

    expect(axios.post).not.toHaveBeenCalled();
    expect(lockWrite(writesOf(1)).data.ExpressionAttributeValues[":to"]).toBe("failed");
  });

  it("refuses a booking with nothing to charge before any write", async () => {
    getOneByGlobalId.mockResolvedValue({ bookingId: "booking-1", userId: "user-1", status: "in progress", feeValues: { bookingTotal: 0 } });

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toMatchObject({ code: 400 });
    expect(axios.post).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ["a refusal", new Exception("Not authorized to complete this booking", { code: 403, data: { refusal: "owner" } })],
    ["a Cognito 503", new Exception("The service is busy.", { code: 503, data: { retryAfter: 2 } })],
  ])("does not charge when completion fails with %s, and passes the error on", async (_label, completionError) => {
    completeBooking.mockRejectedValue(completionError);

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toBe(completionError);
    expect(axios.post).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it("refuses a second payment while one is in flight with 409, without charging", async () => {
    getOne.mockResolvedValue({ status: "in progress", attemptCount: 1, activeClientTransactionId: "BCPR-first" });

    const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

    expect(err).toMatchObject({ code: 409, data: { refusal: "duplicate_payment", clientTransactionId: "BCPR-first" } });
    expect(axios.post).not.toHaveBeenCalled();
    expect(completeBooking).not.toHaveBeenCalled();
  });

  it("refuses a paid booking with 409 duplicate_payment", async () => {
    getOneByGlobalId.mockResolvedValue({ bookingId: "booking-1", userId: "user-1", status: "confirmed", feeValues: { bookingTotal: 12.5 } });

    const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

    expect(err).toMatchObject({ code: 409, data: { refusal: "duplicate_payment" } });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("stores a declined payment as FAILED on the attempt and the lock, and reports the decline", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse({ approved: "0", message: "DECLINE" }) });

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toMatchObject({ code: 400 });

    const writes = writesOf(1);
    expect(attemptWrite(writes).data.ExpressionAttributeValues).toMatchObject({
      ":status": "failed",
      ":trnApproved": "0",
      ":trnMessage": "DECLINE",
    });
    expect(lockWrite(writes).data.ExpressionAttributeValues[":to"]).toBe("failed");
    expect(writes).not.toContainEqual(bookingUpdate);
  });

  it.each([
    ["a timeout with no response", Object.assign(new Error("timeout of 7000ms exceeded"), { code: "ECONNABORTED" })],
    ["a 5xx from Worldline", Object.assign(new Error("Service Unavailable"), { response: { status: 503, data: {} } })],
  ])("records %s as UNKNOWN and answers 502 payment_unconfirmed", async (_label, providerError) => {
    axios.post.mockRejectedValue(providerError);

    const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

    expect(err).toMatchObject({ code: 502, data: { refusal: "payment_unconfirmed" } });
    const writes = writesOf(1);
    expect(attemptWrite(writes).data.ExpressionAttributeValues[":status"]).toBe("unknown");
    expect(lockWrite(writes).data.ExpressionAttributeValues[":to"]).toBe("unknown");
  });

  describe("when the booking can no longer complete after an approved charge", () => {
    const voidUrl = "https://api.na.bambora.com/v1/payments/10000123/void";

    beforeEach(() => {
      batchTransactData
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(conditionFailed)
        .mockResolvedValue(true);
    });

    it("voids the charge and answers 500 saying it was reversed", async () => {
      axios.post
        .mockResolvedValueOnce({ data: worldlineResponse() })
        .mockResolvedValueOnce({ data: { id: "10000124", approved: "1", message: "Approved", type: "VP" } });

      const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

      expect(err).toMatchObject({ code: 500, data: { chargeReversed: true } });
      expect(err.message).toMatch(/reversed and you have not been charged/);
      expect(axios.post.mock.calls[1].slice(0, 2)).toEqual([voidUrl, { amount: 12.5 }]);
      expect(lockWrite(writesOf(3)).data.ExpressionAttributeValues).toMatchObject({ ":from": "paid", ":to": "void" });
    });

    it("keeps the charge paid for reconciliation and says so when the void is refused", async () => {
      axios.post
        .mockResolvedValueOnce({ data: worldlineResponse() })
        .mockRejectedValueOnce(Object.assign(new Error("Request failed with status code 402"), {
          response: { status: 402, data: { code: 205, message: "Transaction only voidable on the date processed" } },
        }));

      const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

      expect(err).toMatchObject({ code: 500, data: { chargeReversed: false } });
      expect(err.message).toMatch(/could not be reversed/);
      expect(batchTransactData).toHaveBeenCalledTimes(3);
    });

    it("keeps an approved charge as SUCCESS flagged for reconciliation", async () => {
      axios.post.mockResolvedValue({ data: worldlineResponse() });
  
      await processTokenTransaction(body, "user-1", null).catch((e) => e);
  
      const writes = writesOf(2);
      expect(writes).not.toContainEqual(bookingUpdate);
      expect(attemptWrite(writes).data.ExpressionAttributeValues).toMatchObject({
        ":status": "paid",
        ":bookingCompletionFailed": true,
        ":needsReconciliation": true,
      });
      expect(lockWrite(writes).data.ExpressionAttributeValues).toMatchObject({
        ":to": "paid",
        ":needsReconciliation": true,
      });
    });
  });

  describe("with a lock stuck in 'unknown'", () => {
    const stuckFor = (minutes) =>
      getOne.mockResolvedValue({
        status: "unknown",
        attemptCount: 1,
        activeClientTransactionId: "BCPR-stuck",
        pendingSince: new Date(Date.now() - minutes * 60 * 1000).toISOString(),
      });

    beforeEach(() => {
      process.env.REPORTING_API_SECRET = "/secrets/reportingApiPasscode";
      stuckFor(10);
      getOneByGlobalId.mockImplementation(async (id) =>
        id === "BCPR-stuck"
          ? { pk: "transaction::booking-1", sk: "2026-06-11::BCPR-stuck", bookingId: "booking-1", clientTransactionId: "BCPR-stuck", status: "unknown" }
          : { bookingId: "booking-1", userId: "user-1", status: "in progress", feeValues: { bookingTotal: 12.5 } },
      );
    });

    afterEach(() => {
      delete process.env.REPORTING_API_SECRET;
    });

    it("refuses 409 already paid without charging when Worldline approved the stuck attempt", async () => {
      axios.post.mockResolvedValueOnce({ data: { records: [{ trn_id: 10000099 }] } });
      axios.get.mockResolvedValueOnce({ data: { id: "10000099", approved: 1, message: "Approved" } });

      const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

      expect(err).toMatchObject({ code: 409, message: "Booking has already been paid", data: { refusal: "duplicate_payment" } });
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(completeBooking).not.toHaveBeenCalled();
    });

    it("keeps refusing 409 without charging while Worldline has no record of an attempt 10 minutes old", async () => {
      axios.post.mockResolvedValueOnce({ data: { records: [] } });

      const err = await processTokenTransaction(body, "user-1", null).catch((e) => e);

      expect(err).toMatchObject({ code: 409, data: { refusal: "duplicate_payment", paymentStatus: "unknown" } });
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(batchTransactData.mock.calls.flat(2).some((op) => op.data.ExpressionAttributeValues?.[":to"])).toBe(false);
    });

    it("fails the stuck attempt and charges a new one when Worldline has no record of it after 31 minutes", async () => {
      stuckFor(31);
      axios.post
        .mockResolvedValueOnce({ data: { records: [] } })
        .mockResolvedValueOnce({ data: worldlineResponse() });

      const result = await processTokenTransaction(body, "user-1", null);

      expect(result.status).toBe("paid");
      expect(lockWrite(writesOf(0)).data.ExpressionAttributeValues).toMatchObject({ ":from": "unknown", ":to": "failed" });
      expect(lockWrite(writesOf(1)).data.ExpressionAttributeValues).toMatchObject({ ":previousAttemptCount": 1 });
    });
  });
});

describe("updateTransactionForRefund through TRANSACTION_UPDATE_CONFIG", () => {
  const transaction = {
    pk: "transaction::booking-1",
    sk: "2026-06-11::BCPR-1",
    refundAmounts: [{ "RFND-old": 2 }],
  };

  it("marks the transaction refund-in-progress and appends the new refund amount", async () => {
    const update = await updateTransactionForRefund(transaction, 5, "RFND-new", 7);
    const [op] = await quickApiUpdateHandler("TransactionalDataTable", [update], TRANSACTION_UPDATE_CONFIG);

    expect(op.action).toBe("Update");
    expect(op.data.Key).toEqual({ pk: "transaction::booking-1", sk: "2026-06-11::BCPR-1" });
    expect(op.data.ConditionExpression).toBe("attribute_exists(pk)");
    const values = Object.values(op.data.ExpressionAttributeValues);
    expect(values).toContain("refund in progress");
    expect(values).toContainEqual([{ "RFND-old": 2 }, { "RFND-new": 5 }]);
  });

  it("rejects a status outside the transaction lifecycle", async () => {
    const update = { key: { pk: "transaction::b", sk: "s" }, data: { status: "confirmed" } };

    await expect(
      quickApiUpdateHandler("TransactionalDataTable", [update], TRANSACTION_UPDATE_CONFIG)
    ).rejects.toMatchObject({ code: 400, message: "Validation failed for field 'status'" });
  });
});

describe("updateTransactionForPayment guards", () => {
  const record = {
    pk: "transaction::booking-1",
    sk: "2026-06-11::BCPR-1",
    status: "in progress",
    bookingId: "booking-1",
    sessionId: "session-1",
    amount: 12.5,
    trnId: "10000123",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks an approved callback as paid against the stored row", async () => {
    getOneByGlobalId.mockResolvedValue(record);
    axios.get.mockResolvedValue({
      data: {
        id: "10000123",
        order_number: "BCPR-1",
        approved: "1",
        amount: 12.5,
      },
    });

    const result = await updateTransactionForPayment(
      "BCPR-1",
      "booking-1",
      "session-1",
      { trnApproved: "1", trnId: "10000123", trnAmount: "12.50" },
    );

    expect(result.key).toEqual({ pk: "transaction::booking-1", sk: "2026-06-11::BCPR-1" });
    expect(result.data.status).toBe("paid");
  });

  it("refuses a callback that the Worldline API reports as declined", async () => {
    getOneByGlobalId.mockResolvedValue(record);
    axios.get.mockResolvedValue({
      data: { id: "10000123", order_number: "BCPR-1", approved: "0", amount: 12.5 },
    });

    await expect(
      updateTransactionForPayment(
        "BCPR-1",
        "booking-1",
        "session-1",
        { trnApproved: "1", trnId: "10000123", trnAmount: "12.50" },
      ),
    ).rejects.toMatchObject({ code: 400 });
  });

  it("refuses a callback whose amount differs from the verified payment", async () => {
    getOneByGlobalId.mockResolvedValue(record);
    axios.get.mockResolvedValue({
      data: { id: "10000123", order_number: "BCPR-1", approved: "1", amount: 12.5 },
    });

    await expect(
      updateTransactionForPayment(
        "BCPR-1",
        "booking-1",
        "session-1",
        { trnApproved: "1", trnId: "10000123", trnAmount: "99.00" },
      ),
    ).rejects.toMatchObject({ code: 400 });
  });

  it.each([
    ["the transaction is no longer in progress", { ...record, status: "paid" }, "booking-1", "session-1"],
    ["the booking id does not match", record, "booking-2", "session-1"],
    ["the session id does not match", record, "booking-1", "session-2"],
  ])("refuses with 400 when %s", async (_label, stored, bookingId, sessionId) => {
    getOneByGlobalId.mockResolvedValue(stored);

    await expect(
      updateTransactionForPayment("BCPR-1", bookingId, sessionId, { trnApproved: "1" })
    ).rejects.toMatchObject({ code: 400, message: "Error updating transaction" });
  });
});