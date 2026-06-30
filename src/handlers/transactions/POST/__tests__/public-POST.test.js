"use strict";

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
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
  getRequestClaimsFromEvent: jest.fn((event) => {
    const authHeader = event?.headers?.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    try {
      const payloadBase64 = token.split(".")[1];
      const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf-8");
      return JSON.parse(payloadJson);
    } catch (e) {
      return null;
    }
  }),
}));

jest.mock("../../methods", () => ({
  processTokenTransaction: jest.fn(),
}));

const optBase = require("/opt/base");
const { handler } = require("../public");
const { processTokenTransaction } = require("../../methods");
const { batchTransactData } = require("/opt/dynamodb");

const DATE = new Date("2026-06-11T12:00:00Z").toISOString().split('T')[0]
const MOCK_BOOKING_ID = "booking-123";
const MOCK_SESSION_ID = "session-123";
const MOCK_TOKEN = "token-123";
const TRANSACTION_ID = `BCPR-${MOCK_BOOKING_ID}`;
const MOCK_USER_ID = "user-123";

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({ bookingId = MOCK_BOOKING_ID, sub = MOCK_USER_ID, body = {} } = {}) {
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

describe("Public Transaction POST handler", () => {
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
  it("succeeds with bookingId, transaction amount, token, sessionId, and proper booking body", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        sessionId: MOCK_SESSION_ID,
        token: MOCK_TOKEN,
        trnAmount: 10,
        userId: MOCK_USER_ID,
      },
    });

    const result = await handler(event, {});

    const resultRes = result.data.response
    expect(resultRes.success).toBe(true);
    expect(resultRes.transactionStatus).toBe('paid');
  });

  // Malformed or missing transaction items tests
  it("fails if the bookingId is missing", async () => {
    const event = makeEvent({
      bookingId: "",
      body: {
        bookingId: "",
        sessionId: MOCK_SESSION_ID,
        token: MOCK_TOKEN,
        trnAmount: 10,
        userId: MOCK_USER_ID,
      },
    });

    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'bookingId'",
    );
  });

  it("fails if the sessionId is missing", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        sessionId: "",
        token: MOCK_TOKEN,
        trnAmount: 10,
        userId: MOCK_USER_ID,
      },
    });

    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'sessionId'",
    );
  });

  it("fails if the token is missing", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        sessionId: MOCK_SESSION_ID,
        token: "",
        trnAmount: 10,
        userId: MOCK_USER_ID,
      },
    });

    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'token'",
    );
  });

  it("fails if the transaction amount (trnAmount) is $0", async () => {
    const event = makeEvent({
      body: {
        bookingId: MOCK_BOOKING_ID,
        sessionId: MOCK_SESSION_ID,
        token: MOCK_TOKEN,
        trnAmount: 0,
        userId: MOCK_USER_ID,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Missing required transaction field 'trnAmount'",
    );
  });

  it("fails if the userId is missing", async () => {
    const event = makeEvent({
      sub: "",
      body: {
        bookingId: MOCK_BOOKING_ID,
        sessionId: MOCK_SESSION_ID,
        token: MOCK_TOKEN,
        trnAmount: 10,
        userId: "",
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(401);
    expect(result.error.message).toBe(
      "Unauthorized: Authentication required to create transaction",
    );
  });
});
