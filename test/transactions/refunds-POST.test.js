"use strict";

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
  // TODO: update this properly for cognito auth
  getRequestClaimsFromEvent: jest.fn((event) => {
    const authHeader = event?.headers?.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    // For testing, we will just decode the token as a base64 JSON string
    try {
      const payloadBase64 = token.split(".")[1];
      const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf-8");
      const payload = JSON.parse(payloadJson);
      return { sub: payload.sub };
    } catch (e) {
      return null;
    }
  }),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  TRANSACTIONAL_DATA_TABLE_NAME: "TestTable",
}));

jest.mock("../../src/common/data-utils", () => ({
  quickApiPutHandler: jest.fn(),
}));

jest.mock("../../src/handlers/transactions/configs", () => ({
  REFUND_PUT_CONFIG: {},
}));

jest.mock("../../src/handlers/transactions/methods", () => ({
  createRefund: jest.fn(),
  createAndCheckRefundHash: jest.fn(),
  findAndVerifyTransactionOwnership: jest.fn(),
}));

const { handler } = require("../../src/handlers/transactions/refunds/POST/index");
const {
  createRefund,
  createAndCheckRefundHash,
  findAndVerifyTransactionOwnership,
} = require("../../src/handlers/transactions/methods");
const { quickApiPutHandler } = require("../../src/common/data-utils");
const { batchTransactData } = require("/opt/dynamodb");

describe("Transaction Refund POST handler", () => {
  const context = {};
  const mockTransactionId = "BCPR-abc123";
  const mockUser = "user-123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 401 if user is missing", async () => {
    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0 }),
      headers: {},
    };

    const result = await handler(event, context);

    expect(result.status).toBe(401);
    expect(result.message).toBe("Cannot issue refund - missing required parameter(s): userId");
  });

  // Create a JWT token with the user sub
  const jwtPayload = { sub: mockUser };
  const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
    "base64"
  );
  const fakeToken = `header.${base64Payload}.signature`;

  it("should return 400 if transactionId is missing", async () => {
    const event = {
      pathParameters: {},
      body: JSON.stringify({ trnAmount: 50.0 }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(400);
    expect(result.message).toBe("Cannot issue refund - missing required parameter(s): transactionId");
  });

  it("should return 400 if trnAmount is missing", async () => {
    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({}),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(400);
    expect(result.message).toBe("Cannot issue refund - missing required parameter(s): trnAmount");
  });

  it("should handle missing multiple items (body, trnAmount)", async () => {
    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: null,
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(400);
    expect(result.message).toBe("Cannot issue refund - missing required parameter(s): body, trnAmount");
  });

  it("should successfully create a refund", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: mockTransactionId,
      transactionStatus: "paid",
      amount: 100.0,
      trnId: "worldline-123",
      userId: mockUser,
    };

    const mockRefundHash = {
      refundHash: "hash123",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 50.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz" },
      data: {
        refundTransactionId: "RFND-xyz",
        amount: 50.0,
      },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundHash);
    createRefund.mockResolvedValue(mockRefundData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0, reason: "Cancelled by user via self-serve" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(findAndVerifyTransactionOwnership).toHaveBeenCalledWith(
      mockTransactionId,
      mockUser
    );
    expect(createAndCheckRefundHash).toHaveBeenCalledWith(
      mockUser,
      mockTransactionId,
      50.0
    );
    expect(createRefund).toHaveBeenCalledWith(
      mockTransaction,
      50.0,
      mockRefundHash,
      { trnAmount: 50.0, reason: "Cancelled by user via self-serve" }
    );
    expect(quickApiPutHandler).toHaveBeenCalled();
    expect(batchTransactData).toHaveBeenCalled();

    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
  });

  it("should return 409 if transaction is already fully refunded", async () => {
    const mockTransaction = {
      clientTransactionId: mockTransactionId,
      transactionStatus: "refunded",
      userId: mockUser,
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0 }),
            headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(409);
    expect(result.message).toBe("Transaction already fully refunded");
  });

  it("should return 401 if user does not own the transaction", async () => {
    const error = {
      message: "Unauthorized access to transaction",
      code: 401,
    };

    findAndVerifyTransactionOwnership.mockRejectedValue(error);

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0 }),
            headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(401);
    expect(result.message).toContain("Unauthorized");
  });

  it ("should throw an error if the user is anonymous (guest checkout not allowed)", async () => {
    const mockTransaction = {
      clientTransactionId: mockTransactionId,
      transactionStatus: "paid",
      userId: "anonymous",
    };

    // Mock should throw the error since the real function would throw it
    const { Exception } = require("/opt/base");
    findAndVerifyTransactionOwnership.mockRejectedValue(
      new Exception("Anonymous transaction requires verification", { code: 403 })
    );

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0 }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(403);
    expect(result.message).toContain("Anonymous transaction requires verification");
  });

  it("should handle duplicate refund attempts (idempotency test)", async () => {
    const mockTransaction = {
      clientTransactionId: mockTransactionId,
      transactionStatus: "paid",
      userId: mockUser,
    };

    const error = {
      message: "Duplicate refund attempt detected",
      code: 409,
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockRejectedValue(error);

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0 }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(409);
    expect(result.message).toContain("Duplicate");
  });

  it("should handle partial refunds", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: mockTransactionId,
      transactionStatus: "partial refund",
      amount: 100.0,
      userId: mockUser,
    };

    const mockRefundHash = {
      refundHash: "hash456",
      refundSequence: 2,
      totalRefunded: 30.0,
      totalAfterRefund: 60.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz2" },
      data: {
        refundTransactionId: "RFND-xyz2",
        amount: 30.0,
      },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundHash);
    createRefund.mockResolvedValue(mockRefundData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 30.0 }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(200);
    expect(createRefund).toHaveBeenCalledWith(
      mockTransaction,
      30.0,
      mockRefundHash,
      { trnAmount: 30.0 }
    );
  });

  it("should handle errors during database operations", async () => {
    const mockTransaction = {
      clientTransactionId: mockTransactionId,
      transactionStatus: "paid",
      userId: mockUser,
    };

    const mockRefundHash = {
      refundHash: "hash789",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 50.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz" },
      data: { refundTransactionId: "RFND-xyz" },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundHash);
    createRefund.mockResolvedValue(mockRefundData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    batchTransactData.mockRejectedValue({
      message: "Dynamo connection error here",
      code: 500,
    });

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({ trnAmount: 50.0 }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(500);
    expect(result.message).toContain("Dynamo connection error here");
  });

  it("should include reason in refund data when provided", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: mockTransactionId,
      transactionStatus: "paid",
      amount: 100.0,
      userId: mockUser,
    };

    const mockRefundHash = {
      refundHash: "hash999",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 50.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz" },
      data: { refundTransactionId: "RFND-xyz" },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundHash);
    createRefund.mockResolvedValue(mockRefundData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      pathParameters: { transactionId: mockTransactionId },
      body: JSON.stringify({
        trnAmount: 50.0,
        reason: "Campsite unavailable",
      }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    await handler(event, context);

    const createRefundCall = createRefund.mock.calls[0];
    expect(createRefundCall[3]).toEqual({
      trnAmount: 50.0,
      reason: "Campsite unavailable",
    });
  });
});
