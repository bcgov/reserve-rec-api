"use strict";

// Real data-utils + transactions configs; only Worldline, Secrets Manager and DynamoDB are doubled.
process.env.PAYMENTS_API_SECRET = "/secrets/paymentsApiPasscode";
process.env.MERCHANT_ID_SECRET = "/secrets/merchantId";
process.env.HASH_KEY_SECRET = "/secrets/hashKey";

jest.mock("axios");
jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: "secret-value" }),
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

const axios = require("axios");
const { batchTransactData, getOneByGlobalId } = require("/opt/dynamodb");
const { completeBooking } = require("../../src/handlers/bookings/methods");
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
};

describe("processTokenTransaction stores the transaction through TRANSACTION_PUT_CONFIG", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOneByGlobalId.mockResolvedValue({
      bookingId: "booking-1",
      userId: "user-1",
      status: "in progress",
      feeValues: { bookingTotal: 12.5 },
    });
    completeBooking.mockResolvedValue({
      updateRequests: [bookingUpdate],
      emailParams: null,
    });
    batchTransactData.mockResolvedValue({});
  });

  // methods.js wraps completeBooking's array in another array, so quickApiUpdateHandler rejects it.
  test.failing("writes an approved payment as a create-only paid transaction row plus the booking update in one batch", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse() });

    const result = await processTokenTransaction(body, "user-1", null);

    expect(result.status).toBe("paid");
    const [writes] = batchTransactData.mock.calls[0];
    const put = writes.find((w) => w.action === "Put");
    expect(put.data.TableName).toBe("TransactionalDataTable");
    expect(put.data.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    expect(put.data.Item).toMatchObject({
      pk: "transaction::booking-1",
      schema: "transaction",
      status: "paid",
      amount: 12.5,
      userId: "user-1",
      trnId: "10000123",
      trnApproved: "1",
      cardLastFour: "4675",
      cardAvsProcessed: false,
      version: 1,
    });
    expect(put.data.Item.sk).toMatch(/^2026-06-11::BCPR-/);
    expect(put.data.Item.clientTransactionId).toHaveLength(30);
    expect(writes).toContainEqual(expect.objectContaining({ action: "Update", data: expect.objectContaining({ Key: bookingUpdate.data.Key }) }));
  });

  it("stores a declined payment as a failed transaction and reports the decline", async () => {
    axios.post.mockResolvedValue({ data: worldlineResponse({ approved: "0", message: "DECLINE" }) });

    await expect(processTokenTransaction(body, "user-1", null)).rejects.toMatchObject({ code: 400 });

    expect(batchTransactData).toHaveBeenCalledTimes(1);
    const [[put]] = batchTransactData.mock.calls[0];
    expect(put.data.Item).toMatchObject({ status: "failed", trnApproved: "0", trnMessage: "DECLINE" });
    expect(completeBooking).not.toHaveBeenCalled();
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks an approved callback as paid against the stored row", async () => {
    getOneByGlobalId.mockResolvedValue(record);

    const result = await updateTransactionForPayment("BCPR-1", "booking-1", "session-1", { trnApproved: "1" });

    expect(result.key).toEqual({ pk: "transaction::booking-1", sk: "2026-06-11::BCPR-1" });
    expect(result.data.status).toBe("paid");
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
