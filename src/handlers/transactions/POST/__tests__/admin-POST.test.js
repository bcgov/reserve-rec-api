"use strict";

jest.mock("/opt/base", () => {
  const mockException = jest.fn(function (message, options) {
    this.message = message;
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
        // Infer the user is superadmin if the ID is our mock admin, otherwise it's the customer
        const role =
          claims.role ||
          (claims.sub === "admin-123" ? "superadmin" : "customer");

        if (requiredRole && role !== requiredRole) {
          throw new mockException("Forbidden: Access Denied", { code: 403 });
        }
        return { ...claims, role };
      }
      // If credentials are completely missing, return a "guest" context
      // so the handler's manual !adminId check handles it and throws its unique error message
      return { role: "guest" };
    }),
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  batchWriteData: jest.fn(),
  marshall: jest.fn((value) => value),
  AUDIT_TABLE_NAME: "AuditTable",
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../methods", () => ({
  processTokenTransaction: jest.fn(),
}));

const optBase = require("/opt/base");
const { handler } = require("../admin");
const { processTokenTransaction } = require("../../methods");
const { batchTransactData } = require("/opt/dynamodb");

const MOCK_BOOKING_ID = "booking-123";
const MOCK_ADMIN_ID = "admin-123";
const MOCK_USER_ID = "user-123";
const TRANSACTION_ID = `BCPR-${MOCK_BOOKING_ID}`
const DATE = new Date("2026-06-11T12:00:00Z").toISOString().split('T')[0]

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({ bookingId = MOCK_BOOKING_ID, sub = MOCK_ADMIN_ID, body = {} } = {}) {
  const headers = sub ? { Authorization: `Bearer ${makeToken(sub)}` } : {};
  return {
    httpMethod: "POST",
    pathParameters: { bookingId },
    body: JSON.stringify(body),
    headers,
  };
}

const baseTransaction = {
  success: true,
  transactionStatus: "paid",
  trnId: "transaction_123",
  message: "a message",
  transaction: {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `${DATE}::${TRANSACTION_ID}`,
    amount: 10,
    bookingId: MOCK_BOOKING_ID,
    clientTransactionId: TRANSACTION_ID,
    date: DATE,
    globalId: TRANSACTION_ID,
    schema: "transaction",
    transactionStatus: "paid",
    transactionUrl: "token-payment",
    userId: MOCK_USER_ID,
    trnId: "trn_123",
    trnApproved: 1,
    messageText: "a message",
    authCode: 123,
  },
};

describe("Admin Transaction POST handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    processTokenTransaction.mockResolvedValue({ ...baseTransaction });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Happy path
  it("succeeds with bookingId, transaction amount, token, and proper booking body", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    const resultRes = result.data.response
    expect(resultRes.success).toBe(true);
    expect(resultRes.transactionStatus).toBe('paid');
  });

  // Malformed or missing transaction items tests
  it("fails if the adminId is missing", async () => {
    const event = makeEvent({
      sub: "",
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(401);
    expect(result.error.message).toBe(
      "Unauthorized: Authentication required to create transaction",
    );
  });

  it("fails if the bookingId is missing", async () => {
    const event = makeEvent({
      bookingId: "",
      body: {
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'bookingId'",
    );
  });

  it("fails if the transaction amount (trnAmount) is $0", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 0,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'trnAmount'",
    );
  });

  it("fails if the token is missing", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "",
      },
    });

    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'token'",
    );
  });

  // Write to the Audit Table tests
  it("writes an audit after a successful payment", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect(optBase.writeAuditLog).toHaveBeenCalledWith(
      MOCK_ADMIN_ID,
      TRANSACTION_ID,
      "ADMIN_PAYMENT_SUCCESS",
      expect.objectContaining({
        transaction: baseTransaction.transaction,
      }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("writes an audit after a unsuccessful payment (no trnAmount)", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 0,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect(optBase.writeAuditLog).toHaveBeenCalledWith(
      MOCK_ADMIN_ID,
      TRANSACTION_ID,
      "ADMIN_PAYMENT_FAILURE",
      expect.objectContaining({
        success: false,
        message: "Missing required transaction field 'trnAmount'",
      }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("fails if a non-admin tries to access the admin payment endpoint", async () => {
    const event = makeEvent({
      sub: MOCK_USER_ID,
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(403);
    expect(result.error.message).toContain("Forbidden");
  });

  it("fails if a standard user tries to pay on behalf of a different userId", async () => {
    const event = makeEvent({
      sub: MOCK_USER_ID, 
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: "fake-user-999", 
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(403);
    expect(result.error.message).toContain("Forbidden");
  });

  it("fails if checkAuthContext returns no valid credentials or role", async () => {
    optBase.checkAuthContext.mockImplementationOnce(() => {
      throw new optBase.Exception("Unauthorized: Invalid session", {
        code: 401,
      });
    });

    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        trnAmount: 10,
        userId: MOCK_USER_ID,
        token: "mock-payment-token",
      },
    });

    const result = await handler(event, {});

    expect([401, 403]).toContain(result.status);
  });
});
