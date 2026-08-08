"use strict";

const OLD_ENV = process.env;
process.env.IS_OFFLINE = "false";

process.env.PAYMENTS_API_SECRET = "/secrets/adminApiStack/paymentsApiPasscode";
process.env.MERCHANT_ID_SECRET = "/secrets/adminApiStack/merchantId";
process.env.HASH_KEY_SECRET = "/secrets/adminApiStack/hashKey";

jest.mock("axios");
const axios = require("axios");

jest.mock("crypto", () => {
  const mockDigest = jest.fn(() => "mocked_sha256_hash_value");
  const mockUpdate = jest.fn(() => ({ digest: mockDigest }));
  const mockCreateHash = jest.fn(() => ({ update: mockUpdate }));

  return {
    randomUUID: jest.fn(() => "mock-uuid-1234"),
    createHash: mockCreateHash,
    _mockCreateHash: mockCreateHash,
    _mockUpdate: mockUpdate,
    _mockDigest: mockDigest,
  };
});

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

jest.mock("/opt/base", () => {
  const { DateTime } = require("luxon");

  return {
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
    getNow: jest.fn((tz = "UTC") => DateTime.now().setZone(tz)),
    getNowISO: jest.fn((tz = "UTC") => DateTime.now().setZone(tz).toISO()),
  };
});

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  getOneByGlobalId: jest.fn(),
  putItem: jest.fn(),
  runQuery: jest.fn(),
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../../common/data-utils", () => ({
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));

const {
  createWorldlineUuidWithPrefix,
  createAndCheckRefundHash,
  createRefund,
  findAndVerifyTransactionOwnership,
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate,
  getTransactionByTransactionId,
  processTokenTransaction,
  getAllRefundsByBookingId,
  getRefundByRefundId,
} = require("../methods");
const {
  batchTransactData,
  getOneByGlobalId,
  putItem,
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
  const TRANSACTION_ID = "transaction-123";

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
      PAYMENTS_API_SECRET: "/secrets/adminApiStack/paymentsApiPasscode",
      MERCHANT_ID_SECRET: "/secrets/adminApiStack/merchantId",
      HASH_KEY_SECRET: "/secrets/adminApiStack/hashKey",
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
        created: "2026-06-11T08:08:51",
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
    expect(result.status).toBe("paid");
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
  const TRANSACTION_ID = "transaction-123";
  const DATE = new Date("2026-06-11T12:00:00Z").toISOString().split("T")[0];

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
      items: [baseTransaction],
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
          ":pk": { S: `transaction::${MOCK_BOOKING_ID}` },
        },
      }),
    );
  });

  it("gets all transactions using a bookingId and date", async () => {
    const date = new Date("2026-06-11T12:00:00Z").toISOString().split("T")[0];

    const result = await getTransactionsByBookingIdDate(MOCK_BOOKING_ID, date);

    expect(result).toEqual({ items: [baseTransaction] });

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

    expect(getOneByGlobalId).toHaveBeenCalledWith(
      "transaction-123",
      "TransactionalDataTable",
      "globalId",
      "globalId-index",
    );
  });

  it("throws a custom Exception if the database query fails", async () => {
    // Force a failure
    runQuery.mockRejectedValueOnce(new Error("DynamoDB went offline"));

    await expect(
      getTransactionsByBookingId(MOCK_BOOKING_ID),
    ).rejects.toMatchObject({
      code: 400,
      message: "Error getting transactions by bookingId",
    });
  });

  it("throws a custom Exception if the getOneByGlobalId query fails", async () => {
    const date = new Date("2026-06-11T12:00:00Z").toISOString().split("T")[0];

    // Force a failure
    runQuery.mockRejectedValueOnce(new Error("DynamoDB went offline"));

    await expect(
      getTransactionsByBookingIdDate(MOCK_BOOKING_ID, date),
    ).rejects.toMatchObject({
      code: 400,
      message: "Error getting transactions by bookingId and date",
    });
  });

  it("throws a custom Exception if the getOneByGlobalId query fails", async () => {
    // Force a failure
    getOneByGlobalId.mockRejectedValueOnce(new Error("DynamoDB went offline"));

    await expect(
      getTransactionByTransactionId(TRANSACTION_ID),
    ).rejects.toMatchObject({
      code: 400,
      message: "Error getting transaction by clientTransactionId",
    });
  });
});

describe("Methods: findAndVerifyTransactionOwnership", () => {
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123";
  const DATE = new Date("2026-06-11T12:00:00Z").toISOString().split("T")[0];

  const baseTransaction = {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `${DATE}::${TRANSACTION_ID}`,
    amount: 10,
    authCode: `TEST`,
    bookingId: MOCK_BOOKING_ID,
    clientTransactionId: TRANSACTION_ID,
    date: DATE,
    globalId: TRANSACTION_ID,
    messageText: `Approved`,
    schema: `transaction`,
    sessionId: `test-session-id`,
    status: `paid`,
    transactionUrl: `token-payment`,
    trnApproved: `1`,
    trnId: `worldline-trn-123`,
    userId: MOCK_USER_ID,
    version: `1`,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };

    runQuery.mockResolvedValue({
      items: [baseTransaction],
    });

    getOneByGlobalId.mockResolvedValue(baseTransaction);

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.useRealTimers();
  });

  it("throws an error if no transaction exists", async () => {
    getOneByGlobalId.mockResolvedValue(null);
    await expect(
      findAndVerifyTransactionOwnership(TRANSACTION_ID, "bad-user-id"),
    ).rejects.toMatchObject({
      code: 404,
      message: "Transaction not found",
    });
  });

  it("throws an error if the userId does not match", async () => {
    await expect(
      findAndVerifyTransactionOwnership(TRANSACTION_ID, "bad-user-id"),
    ).rejects.toMatchObject({
      code: 401,
      message: "Unauthorized access to transaction",
    });
  });

  it("successfully returns a transaction", async () => {
    const result = await findAndVerifyTransactionOwnership(
      TRANSACTION_ID,
      MOCK_USER_ID,
    );

    expect(result.amount).toBe(10);
    expect(result.status).toBe("paid");
  });
});

describe("Methods: createRefund", () => {
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123";
  const DATE = "2026-06-11";

  const baseTransaction = {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `${DATE}::${TRANSACTION_ID}`,
    amount: 10,
    authCode: `TEST`,
    bookingId: MOCK_BOOKING_ID,
    clientTransactionId: TRANSACTION_ID,
    date: DATE,
    globalId: TRANSACTION_ID,
    messageText: `Approved`,
    schema: `transaction`,
    sessionId: `test-session-id`,
    status: `paid`,
    transactionUrl: `token-payment`,
    trnApproved: `1`,
    trnId: `worldline-trn-123`,
    userId: MOCK_USER_ID,
    version: `1`,
  };

  const refundHashes = [
    {
      pk: `refundHash::2026-06-11`,
      sk: `hash-123-123`,
      userId: `${MOCK_USER_ID}`,
      clientTransactionId: `${TRANSACTION_ID}`,
      bookingId: `${MOCK_BOOKING_ID}`,
      refundAmount: 2,
      refundSequence: 1,
      totalRefundedBefore: 0,
      globalId: `hash-123-123`,
      refundHash: `hash-123-123`,
    },
    {
      pk: `refundHash::2026-06-11`,
      sk: `hash-456-456`,
      userId: `${MOCK_USER_ID}`,
      clientTransactionId: `${TRANSACTION_ID}`,
      bookingId: `${MOCK_BOOKING_ID}`,
      refundAmount: 3,
      refundSequence: 2,
      totalRefundedBefore: 2,
      globalId: `hash-456-456`,
      refundHash: `hash-456-456`,
    },
  ];

  // Failed worldline response (Transaction exceeds return limit)
  axios.post.mockResolvedValue({
    data: `
      trnApproved=0&
      messageText=Transaction+exceeds+return+limit%2E&
      trnId=worldline-trn-123&
    `,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    runQuery.mockResolvedValue({
      items: refundHashes,
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("Calls worldline successfully using axios", async () => {
    const refundAmountToIssue = 5;

    axios.post.mockResolvedValueOnce({
      data: "trnApproved=1&messageText=Transaction+totally+fine%2E&trnId=worldline-trn-123&",
    });

    const result = await createRefund(
      baseTransaction,
      refundAmountToIssue,
      refundHashes[0],
      { reason: "reason for refund" },
    );

    expect(axios.post).toHaveBeenCalledTimes(1);

    const [postedUrl, postedBody, postedConfig] = axios.post.mock.calls[0];

    expect(postedUrl).toBe(
      "https://web.na.bambora.com/scripts/process_transaction.asp",
    );

    expect(postedConfig).toEqual({
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const params = new URLSearchParams(postedBody);

    expect(params.get("requestType")).toBe("BACKEND");
    expect(params.get("merchant_id")).toBe("mock-merchant-id");
    expect(params.get("trnType")).toBe("R");
    expect(params.get("adjId")).toBe(baseTransaction.trnId); // "worldline-trn-123"
    expect(params.get("trnAmount")).toBe("5.00");
    expect(params.get("hashValue")).toBe("mocked_sha256_hash_value"); // From mocked crypto
    expect(params.get("trnOrderNumber")).toMatch(/^RFND-/); // Starts with refund prefix

    expect(result.data.status).toBe("refunded");
    expect(result.data.amount).toBe(5);
  });

  it("Fails if Worldline sends a failure (Transaction exceeds return limit.)", async () => {
    const refundAmountToIssue = 5;

    axios.post.mockResolvedValueOnce({
      data: "trnApproved=0&messageText=Transaction+exceeds+return+limit%2E&trnId=worldline-trn-123&",
    });

    await expect(
      createRefund(baseTransaction, refundAmountToIssue, refundHashes[0], {
        reason: "reason for refund",
      }),
    ).rejects.toMatchObject({
      code: 400,
      message: "Worldline refund declined: Transaction exceeds return limit.",
    });
  });
});

describe("Methods: createAndCheckRefundHash", () => {
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123";
  const DATE = "2026-06-11";

  const refundHashes = [
    {
      pk: `transaction::${MOCK_BOOKING_ID}`,
      sk: `refund::${DATE}::RFND-123-123`,
      amount: 2,
      bookingId: MOCK_BOOKING_ID,
      date: DATE,
      createdAt: `${DATE}T10:00:00Z`, // Adding timestamp outside 3 min window
      globalId: "RFND-123-123",
      schema: "refund",
      status: "refunded",
    },
    {
      pk: `transaction::${MOCK_BOOKING_ID}`,
      sk: `refund::${DATE}::RFND-456-456`,
      amount: 3,
      bookingId: MOCK_BOOKING_ID,
      date: DATE,
      createdAt: `${DATE}T10:05:00Z`, // Adding timestamp outside 3 min window
      globalId: "RFND-456-456",
      schema: "refund",
      status: "refunded",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    runQuery.mockResolvedValue({
      items: refundHashes,
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("pulls existing refunds, calculates total/sequence, and saves hash record", async () => {
    const refundAmountToIssue = 5;

    const result = await createAndCheckRefundHash(
      MOCK_USER_ID,
      TRANSACTION_ID,
      refundAmountToIssue,
      MOCK_BOOKING_ID,
    );

    expect(runQuery).toHaveBeenCalledWith({
      TableName: expect.any(String),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `transaction::${MOCK_BOOKING_ID}` },
        ":sk": { S: "refund::" },
      },
    });

    expect(result).toEqual({
      refundHash: expect.any(String),
      refundSequence: 3,
      totalRefunded: 5,
      totalAfterRefund: 10,
    });

    expect(putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: "refundHash::2026-06-11",
        sk: expect.any(String),
        userId: MOCK_USER_ID,
        clientTransactionId: TRANSACTION_ID,
        bookingId: MOCK_BOOKING_ID,
        refundAmount: 5,
        refundSequence: 3,
        totalRefundedBefore: 5,
        createdAt: "2026-06-11T12:00:00.000Z",
      }),
      expect.any(String), // Transaction table
      "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    );
  });

  it("throws 409 conflict when duplicate refund amount occurs within window", async () => {
    const recentDuplicateRefunds = [
      {
        ...refundHashes[0],
        amount: 5, // Same as new request amount
        createdAt: "2026-06-11T11:58:00Z", // 2 minutes ago (within 3 min window)
        status: "refunded",
      },
    ];

    runQuery.mockResolvedValueOnce({
      items: recentDuplicateRefunds,
    });

    await expect(createAndCheckRefundHash(
        MOCK_USER_ID,
        TRANSACTION_ID,
        5,
        MOCK_BOOKING_ID,
        3,
      )).rejects.toMatchObject({
      code: 409,
      message: "Duplicate refund attempt detected",
    });
  });
});

describe("Methods: getAllRefundsByBookingId", () => {
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123";
  const DATE = "2026-06-11";

  const refunds = [
    {
      pk: `transaction::${MOCK_BOOKING_ID}`,
      sk: `refund::${DATE}::RFND-123-123`,
      amount: 1,
      bookingId: `${MOCK_BOOKING_ID}`,
      date: `${DATE}`,
      globalId: `RFND-123-123`,
      originalTransactionId: `${TRANSACTION_ID}`,
      processorRefundId: `worldline-trn-123`,
      refundReason: `Admin initiated refund`,
      refundSequence: 1,
      refundTransactionId: `RFND-123-123`,
      schema: `refund`,
      status: `refunded`,
      trnMessage: `Approved`,
      userId: `${MOCK_USER_ID}`,
      version: 1,
    },
    {
      pk: `transaction::${MOCK_BOOKING_ID}`,
      sk: `refund::${DATE}::RFND-456-456`,
      amount: 2,
      bookingId: `${MOCK_BOOKING_ID}`,
      date: `${DATE}`,
      globalId: `RFND-456-456`,
      originalTransactionId: `${TRANSACTION_ID}`,
      processorRefundId: `worldline-trn-123`,
      refundReason: `Admin initiated refund`,
      refundSequence: 2,
      refundTransactionId: `RFND-456-456`,
      schema: `refund`,
      status: `refunded`,
      trnMessage: `Approved`,
      userId: `${MOCK_USER_ID}`,
      version: 2,
    },
  ];

  const singleRefund = {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `refund::${DATE}::RFND-456-456`,
    amount: 2,
    bookingId: `${MOCK_BOOKING_ID}`,
    date: `${DATE}`,
    globalId: `RFND-456-456`,
    originalTransactionId: `${TRANSACTION_ID}`,
    processorRefundId: `worldline-trn-123`,
    refundReason: `Admin initiated refund`,
    refundSequence: 2,
    refundTransactionId: `RFND-456-456`,
    schema: `refund`,
    status: `refunded`,
    trnMessage: `Approved`,
    userId: `${MOCK_USER_ID}`,
    version: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    runQuery.mockResolvedValue({
      items: refunds,
    });

    getOneByGlobalId.mockResolvedValue(singleRefund);

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("Get a refund by bookingId", async () => {
    const result = await getAllRefundsByBookingId(MOCK_BOOKING_ID);

    expect(result).toHaveLength(2);
  });

  it("Returns an empty array if there are no refunds", async () => {
    runQuery.mockResolvedValue({
      items: [],
    });

    const result = await getAllRefundsByBookingId(
      "fake-booking-id",
    );

    expect(result).toHaveLength(0);
  });

  it("Returns an error if something goes wrong", async () => {
    runQuery.mockResolvedValue(undefined); // cannot read properties

    await expect(
      getAllRefundsByBookingId(MOCK_BOOKING_ID),
    ).rejects.toMatchObject({
      code: 400,
      message: "Error getting refunds by bookingId",
    });
  });
});

describe("Methods: getRefundByRefundId", () => {
  const MOCK_USER_ID = "user-123";
  const MOCK_BOOKING_ID = "booking-123";
  const TRANSACTION_ID = "transaction-123";
  const DATE = "2026-06-11";

  const singleRefund = {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `refund::${DATE}::RFND-456-456`,
    amount: 2,
    bookingId: `${MOCK_BOOKING_ID}`,
    date: `${DATE}`,
    globalId: `RFND-456-456`,
    originalTransactionId: `${TRANSACTION_ID}`,
    processorRefundId: `worldline-trn-123`,
    refundReason: `Admin initiated refund`,
    refundSequence: 2,
    refundTransactionId: `RFND-456-456`,
    schema: `refund`,
    status: `refunded`,
    trnMessage: `Approved`,
    userId: `${MOCK_USER_ID}`,
    version: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    getOneByGlobalId.mockResolvedValue(singleRefund);

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("Returns a specific refund when a refundId is provided", async () => {
    const mockRefundId = "RFND-456-456";
    const result = await getRefundByRefundId(MOCK_BOOKING_ID, mockRefundId);

    expect(result.globalId).toBe(mockRefundId);
  });

  it("Returns an error if the bookingId provided doesn't match the refund's bookingId", async () => {
    const mockRefundId = "RFND-456-456";
    getOneByGlobalId.mockResolvedValue(singleRefund);

    await expect(
      getRefundByRefundId("wrong-booking-id", mockRefundId),
    ).rejects.toMatchObject({
      code: 401,
      message: "The bookingId provided does not match refund's bookingId",
    });
  });
  
  it("Returns an error if no refund exists", async () => {
    const mockRefundId = "RFND-789-789";
    getOneByGlobalId.mockResolvedValue(null);

    await expect(
      getRefundByRefundId(MOCK_BOOKING_ID, mockRefundId),
    ).rejects.toMatchObject({
      code: 404,
      message: "Refund not found",
    });
  });
});
