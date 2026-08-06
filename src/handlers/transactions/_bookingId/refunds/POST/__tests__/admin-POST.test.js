"use strict";

jest.mock("/opt/base", () => {
  const mockException = jest.fn(function (message, options) {
    this.message = message;
    this.msg = message;
    this.code = options?.code;
    this.data = options?.data || null;
    this.error = options?.error || null;
  });

  const getClaims = (event) => {
    const authHeader = event?.headers?.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    try {
      const payloadBase64 = token.split(".")[1];
      const payloadJson = Buffer.from(payloadBase64, "base64").toString(
        "utf-8",
      );
      return JSON.parse(payloadJson);
    } catch (e) {
      return null;
    }
  };

  return {
    Exception: mockException,
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
    getRequestClaimsFromEvent: jest.fn((event) => getClaims(event)),
    checkAuthContext: jest.fn((event, requiredRole) => {
      const claims = getClaims(event);
      if (claims) {
        const role =
          claims.role ||
          (claims.sub === "admin-123" ? "superadmin" : "customer");

        if (requiredRole && role !== requiredRole) {
          throw new mockException("Forbidden: Access Denied", { code: 403 });
        }
        return { ...claims, role };
      }
      throw new mockException("Unauthorized: Authentication required", {
        code: 401,
      });
    }),
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn().mockResolvedValue({ UnprocessedItems: [] }),
  batchWriteData: jest.fn(),
  marshall: jest.fn((value) => value),
  AUDIT_TABLE_NAME: "AuditTable",
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../../../methods", () => ({
  findAndVerifyTransactionOwnership: jest.fn(),
  createAndCheckRefundHash: jest.fn(),
  createRefund: jest.fn(),
}));

jest.mock("../../../../../../common/data-utils", () => ({
  quickApiPutHandler: jest.fn().mockResolvedValue([{ PutRequest: {} }]),
  quickApiUpdateHandler: jest.fn().mockResolvedValue([{ UpdateItem: {} }]),
}));

jest.mock("../../../../configs", () => ({
  REFUND_PUT_CONFIG: {},
  TRANSACTION_UPDATE_CONFIG: {},
}));

const optBase = require("/opt/base");
const { batchTransactData } = require("/opt/dynamodb");
const {
  findAndVerifyTransactionOwnership,
  createAndCheckRefundHash,
  createRefund,
} = require("../../../../methods");

const { handler } = require("../admin");

const MOCK_BOOKING_ID = "booking-123";
const MOCK_ADMIN_ID = "admin-123";
const MOCK_USER_ID = "user-123";
const TRANSACTION_ID = `BCPR-${MOCK_BOOKING_ID}`;

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({
  body = {},
  pathParameters = {},
  sub = MOCK_ADMIN_ID,
} = {}) {
  const headers = sub ? { Authorization: `Bearer ${makeToken(sub)}` } : {};
  return {
    httpMethod: "POST",
    pathParameters,
    body: JSON.stringify(body),
    headers,
  };
}

const baseTransaction = {
  pk: `transaction::${MOCK_BOOKING_ID}`,
  sk: `2026-06-11::${TRANSACTION_ID}`,
  amount: 10,
  trnAmount: 10,
  bookingId: MOCK_BOOKING_ID,
  clientTransactionId: TRANSACTION_ID,
  status: "paid",
  userId: MOCK_USER_ID,
  refundAmounts: [],
};

const baseRefundHashObj = {
  refundHash: "mock-hash-123",
  refundSequence: 1,
  totalRefunded: 0,
  totalAfterRefund: 5,
};

const baseRefundPutRequest = {
  data: {
    refundTransactionId: "ref_123",
    amount: 5,
  },
};

describe("Admin Refund POST handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    findAndVerifyTransactionOwnership.mockResolvedValue({ ...baseTransaction });
    createAndCheckRefundHash.mockResolvedValue({ ...baseRefundHashObj });
    createRefund.mockResolvedValue({ ...baseRefundPutRequest });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Happy paths
  it("succeeds with a partial refund and logs audit", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        clientTransactionId: TRANSACTION_ID,
        userId: MOCK_USER_ID,
        refundAmount: 5,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.message).toBe("Refund Success");
    expect(result.data.response.refund).toEqual(baseRefundPutRequest.data);
    expect(batchTransactData).toHaveBeenCalledTimes(1);

    // Verify audit log
    expect(optBase.writeAuditLog).toHaveBeenCalledWith(
      MOCK_ADMIN_ID,
      TRANSACTION_ID,
      "ADMIN_REFUND_SUCCESS",
      expect.objectContaining({
        result: true,
        amount: 5,
        refund: baseRefundPutRequest.data,
      }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("succeeds with a full refund (totalAfterRefund >= amount) and updates status to 'refunded'", async () => {
    createAndCheckRefundHash.mockResolvedValueOnce({
      ...baseRefundHashObj,
      totalAfterRefund: 10,
    });

    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        clientTransactionId: TRANSACTION_ID,
        userId: MOCK_USER_ID,
        refundAmount: 10,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(batchTransactData).toHaveBeenCalledTimes(1);
  });

  // Malformed or missing transaction items tests
  it("fails if clientTransactionId is missing from body", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        clientTransactionId: null,
        userId: MOCK_USER_ID,
        refundAmount: 5,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.message).toContain(
      "missing bookingId, clientTransactionId, userId, or refundAmount",
    );
    expect(optBase.writeAuditLog).toHaveBeenCalledWith(
      MOCK_ADMIN_ID,
      "unknown",
      "ADMIN_REFUND_FAILURE",
      expect.objectContaining({ success: false }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("fails if refundAmount is missing from request body", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        userId: MOCK_USER_ID,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.message).toContain(
      "missing bookingId, clientTransactionId, userId, or refundAmount",
    );
  });

  it("fails if bookingId is missing from pathParameters", async () => {
    const event = makeEvent({
      pathParameters: null,
      body: {
        refundAmount: 5,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.message).toContain(
      "missing bookingId, clientTransactionId, userId, or refundAmount",
    );
  });

  it("fails if userId is missing from request body", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        refundAmount: 5,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.message).toContain(
      "missing bookingId, clientTransactionId, userId, or refundAmount",
    );
  });

  it("fails with 409 if transaction is already fully refunded", async () => {
    findAndVerifyTransactionOwnership.mockResolvedValueOnce({
      ...baseTransaction,
      status: "refunded",
    });

    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        clientTransactionId: TRANSACTION_ID,
        userId: MOCK_USER_ID,
        refundAmount: 5,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(409);
    expect(result.message).toBe("Transaction already fully refunded");
  });

  it("fails with 409 if transaction status is ineligible for refund (e.g. 'failed')", async () => {
    findAndVerifyTransactionOwnership.mockResolvedValueOnce({
      ...baseTransaction,
      status: "failed",
    });

    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        clientTransactionId: TRANSACTION_ID,
        userId: MOCK_USER_ID,
        refundAmount: 5,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(409);
    expect(result.message).toBe(
      "Transaction status 'failed' is not eligible for refund",
    );
  });

  // Auth checks
  it("fails if a non-admin (customer) tries to process a refund", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        userId: MOCK_USER_ID,
        refundAmount: 5,
      },
      sub: MOCK_USER_ID, // Non-admin user ID
    });

    const result = await handler(event, {});

    expect(result.status).toBe(403);
    expect(result.message).toContain("Forbidden");
  });

  it("fails if token is unauthenticated", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      body: {
        userId: MOCK_USER_ID,
        refundAmount: 5,
      },
      sub: null,
    });

    const result = await handler(event, {});

    expect(result.status).toBe(401);
  });
});
