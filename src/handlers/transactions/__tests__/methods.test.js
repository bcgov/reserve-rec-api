"use strict";

const OLD_ENV = process.env;
process.env.IS_OFFLINE = "false";

process.env.PAYMENTS_API_SECRET = "/reserveRecApi/claveau/adminApiStack/paymentsApiPasscode";
process.env.MERCHANT_ID_SECRET = "/reserveRecApi/claveau/adminApiStack/merchantId";
process.env.HASH_KEY_SECRET = "/reserveRecApi/claveau/adminApiStack/hashKey";

jest.mock("axios");
const axios = require("axios");

jest.mock("crypto", () => ({
  randomUUID: jest.fn(() => "mock-uuid-1234"),
}));

// Mock the Secrets Manager client to return fake secret strings
jest.mock("@aws-sdk/client-secrets-manager", () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockImplementation((command) => {
        const secretId = command.input?.SecretId;
        let secretValue = "mock-secret-value";
        
        // Return different mock values based on the requested secret path
        if (secretId?.includes("merchantId")) {
          secretValue = "mock-merchant-id";
        } else if (secretId?.includes("hashKey")) {
          secretValue = "mock-hash-key";
        } else if (secretId?.includes("paymentsApiPasscode")) {
          secretValue = "test-passcode";
        }
        
        return Promise.resolve({ SecretString: secretValue });
      }),
    })),
    GetSecretValueCommand: jest.fn().mockImplementation((input) => ({
      input,
    })),
  };
});

jest.mock("../../bookings/methods", () => ({
  snsPublishCommand: jest.fn(),
  snsPublishSend: jest.fn(),
  completeBooking: jest.fn((event) => {
    return {
      updateRequests: [
        {
          action: "Update",
          data: {
            TableName: "mock-table",
            Key: {
              pk: { S: "mock::pk" },
              sk: { S: "mock::sk" },
            },
            UpdateExpression: "updateExpression",
            ExpressionAttributeNames: "expressionAttributeNames",
            ExpressionAttributeValues: "expressionAttributeValues",
          },
        },
      ],
    };
  }),
}));

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, options) {
    this.message = message;
    this.code = options?.code;
    this.data = options?.data || null;
    this.error = options?.error || null;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  getNow: jest.fn(() => ({
    toFormat: jest.fn(() => "2026-06-24"),
  })),
}));

jest.mock("/opt/dynamodb", () => ({
  getOneByGlobalId: jest.fn(),
  batchTransactData: jest.fn(),
  runQuery: jest.fn(),
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../../common/data-utils", () => ({
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));

const {
  processTokenTransaction,
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate,
  getTransactionByTransactionId,
} = require("../methods");
const {
  getOneByGlobalId,
  batchTransactData,
  runQuery,
} = require("/opt/dynamodb");
const {
  quickApiPutHandler,
  quickApiUpdateHandler,
} = require("../../../common/data-utils");

describe("Method: processTokenTransaction", () => {
  const MOCK_ADMIN_ID = "admin-123";
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123"

  const baseBody = {
    bookingId: MOCK_BOOKING_ID,
    sessionId: "session-xyz",
    trnAmount: 10,
    userId: MOCK_USER_ID,
    token: "mock-payment-token",
    cardholderName: "Jane Camper",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { 
      ...OLD_ENV,
      IS_OFFLINE: "false",
      PAYMENTS_API_SECRET: "/reserveRecApi/claveau/adminApiStack/paymentsApiPasscode",
      MERCHANT_ID_SECRET: "/reserveRecApi/claveau/adminApiStack/merchantId",
      HASH_KEY_SECRET: "/reserveRecApi/claveau/adminApiStack/hashKey",
    };

    // Axios Worldline Mock
    axios.post.mockResolvedValue({
      data: {
        id: "worldline-trn-123",
        authorizing_merchant_id: 123456789,
        approved: "1",
        message_id: "1",
        message: "Approved",
        auth_code: "TEST",
        created: "2026-06-24T08:08:51",
        order_number: "BCPR-mock-uuid-1234",
        type: "P",
        payment_method: "CC",
        risk_score: 0,
        amount: 10,
        custom: {
          ref1: "standalone-test",
          ref2: "test-session-id",
          ref3: "",
          ref4: "",
          ref5: "",
        },
        card: {
          card_type: "VI",
          last_four: "4675",
          card_bin: "433026",
          address_match: 0,
          postal_result: 0,
          avs_result: "0",
          cvd_result: "1",
          avs: {
            id: "U",
            message: "Address information is unavailable.",
            processed: false,
          },
        },
        links: [
          {
            rel: "void",
            href: "https://api.na.bambora.com/v1/payments/worldline-trn-123/void",
            method: "POST",
          },
          {
            rel: "return",
            href: "https://api.na.bambora.com/v1/payments/worldline-trn-123/returns",
            method: "POST",
          },
        ],
      },
    });

    // Database booking mock
    getOneByGlobalId.mockResolvedValue({
      bookingId: MOCK_BOOKING_ID,
      userId: MOCK_USER_ID,
      status: "pending",
      bookingStatus: "pending",
      feeValues: { bookingTotal: 100 },
    });

    // DynamoDB utils mock
    quickApiPutHandler.mockResolvedValue([
      { Put: { Item: { fakeData: true } } },
    ]);
    quickApiUpdateHandler.mockResolvedValue([
      { Update: { Key: { fakeKey: true } } },
    ]);

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.useRealTimers();
  });

  it("successfully processes a payment and completes the booking", async () => {
    const result = await processTokenTransaction(
      baseBody,
      MOCK_USER_ID,
      MOCK_ADMIN_ID,
    );

    expect(result.success).toBe(true);
    expect(result.transactionStatus).toBe("paid");
    expect(result.transaction.trnId).toBe("worldline-trn-123");

    // Verify Axios was called with the correct Worldline payload
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        payment_method: "token",
        amount: 100,
        token: expect.objectContaining({ code: "mock-payment-token" }),
      }),
      expect.any(Object),
    );

    expect(batchTransactData).toHaveBeenCalledTimes(1);
  });

  it("throws a 403 Exception if the user does not own the booking", async () => {
    getOneByGlobalId.mockResolvedValue({
      bookingId: MOCK_BOOKING_ID,
      userId: "not-user-123",
      status: "pending",
      bookingStatus: "pending",
      feeValues: { bookingTotal: 100 },
    });

    await expect(
      processTokenTransaction(baseBody, MOCK_USER_ID, MOCK_ADMIN_ID),
    ).rejects.toMatchObject({
      code: 403,
      message: "Unauthorized: You do not own this booking",
    });
  });

  it("throws a 400 Exception if the user's booking is confirmed already", async () => {
    getOneByGlobalId.mockResolvedValue({
      bookingId: MOCK_BOOKING_ID,
      userId: MOCK_USER_ID,
      status: "confirmed",
      bookingStatus: "confirmed",
      feeValues: { bookingTotal: 100 },
    });

    await expect(
      processTokenTransaction(baseBody, MOCK_USER_ID, MOCK_ADMIN_ID),
    ).rejects.toMatchObject({
      code: 400,
      message: "Booking has already been paid",
    });
  });

  it("throws a 400 Exception if the user's booking is cancelled already", async () => {
    getOneByGlobalId.mockResolvedValue({
      bookingId: MOCK_BOOKING_ID,
      userId: MOCK_USER_ID,
      status: "cancelled",
      bookingStatus: "cancelled",
      feeValues: { bookingTotal: 100 },
    });

    await expect(
      processTokenTransaction(baseBody, MOCK_USER_ID, MOCK_ADMIN_ID),
    ).rejects.toMatchObject({
      code: 400,
      message: "Booking has been cancelled",
    });
  });

  it("handles Worldline API rejections and writes a 'failed' transaction record", async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 402,
        statusText: "Payment Required",
      },
    });

    await expect(
      processTokenTransaction(baseBody, MOCK_USER_ID, MOCK_ADMIN_ID),
    ).rejects.toMatchObject({ code: 402 });

    expect(quickApiPutHandler).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ status: "failed" }),
        }),
      ]),
      expect.any(Object),
    );
  });
});

describe("Methods: getTransactions", () => {
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123"
  const DATE = new Date("2026-06-11T12:00:00Z").toISOString().split('T')[0]

  const baseTransaction = {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `${DATE}::${TRANSACTION_ID}`,
    amount: 10,
    bookingId: "standalone-test",
    clientTransactionId: TRANSACTION_ID,
    date: `${DATE}`,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };

    // Database booking mock
    getOneByGlobalId.mockResolvedValue({
      bookingId: MOCK_BOOKING_ID,
      userId: MOCK_USER_ID,
      status: "pending",
      bookingStatus: "pending",
      feeValues: { bookingTotal: 100 },
    });

    runQuery.mockResolvedValue({
      items: [ baseTransaction ],
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.useRealTimers();
  });

  it("gets all transactions using a bookingId", async () => {
    const result = await getTransactionsByBookingId(MOCK_BOOKING_ID);

    expect(result).toEqual({ items: [baseTransaction] });
    
    expect(runQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: "TransactionalDataTable",
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": { S: `transaction::${MOCK_BOOKING_ID}` }
        }
      })
    );
  });
  
  it("gets all transactions using a bookingId and date", async () => {
    const date = new Date("2026-06-11T12:00:00Z").toISOString().split('T')[0]
    
    const result = await getTransactionsByBookingIdDate(MOCK_BOOKING_ID, date);

    expect(result).toEqual({ items: [ baseTransaction ] });
    
    expect(runQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: "TransactionalDataTable",
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: `transaction::${MOCK_BOOKING_ID}` },
          ":skPrefix": { S: "2026-06-11" },
        },
      }),
    );
  });
  
  it("gets a transaction using a clientTransactionId", async () => {
    // Override the global mock just for this test
    getOneByGlobalId.mockResolvedValueOnce(baseTransaction);

    const result = await getTransactionByTransactionId(TRANSACTION_ID);

    expect(result).toEqual(baseTransaction);

    expect(getOneByGlobalId).toHaveBeenCalledWith("transaction-123", "TransactionalDataTable", "globalId", "globalId-index");
  });

  it("throws a custom Exception if the database query fails", async () => {
    // Force a failure
    runQuery.mockRejectedValueOnce(new Error("DynamoDB went offline"));

    await expect(getTransactionsByBookingId(MOCK_BOOKING_ID)).rejects.toMatchObject({
      code: 400,
      message: "Error getting transactions by bookingId",
    });
  });

  it("throws a custom Exception if the getOneByGlobalId query fails", async () => {
    const date = new Date("2026-06-11T12:00:00Z").toISOString().split('T')[0]

    // Force a failure
    runQuery.mockRejectedValueOnce(new Error("DynamoDB went offline"));

    await expect(getTransactionsByBookingIdDate(MOCK_BOOKING_ID, date)).rejects.toMatchObject({
      code: 400,
      message: "Error getting transactions by bookingId and date",
    });
  });

  it("throws a custom Exception if the getOneByGlobalId query fails", async () => {
    // Force a failure
    getOneByGlobalId.mockRejectedValueOnce(new Error("DynamoDB went offline"));

    await expect(getTransactionByTransactionId(TRANSACTION_ID)).rejects.toMatchObject({
      code: 400,
      message: "Error getting transaction by clientTransactionId",
    });
  });
});
