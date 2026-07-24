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
  checkAuthContext: jest.fn().mockReturnValue({ role: "superadmin" }), 
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  batchWriteData: jest.fn(),
  marshall: jest.fn((value) => value),
  AUDIT_TABLE_NAME: "AuditTable",
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../methods", () => ({
  getTransactionsByBookingId: jest.fn(),
  getTransactionsByBookingIdDate: jest.fn(),
  getTransactionByTransactionId: jest.fn(),
}));

const optBase = require("/opt/base");
const { handler } = require("../admin");
const { 
  getTransactionByTransactionId,
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate
} = require("../../methods");
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

function makeEvent({ sub, queryStringParameters = {} }) {
  const headers = { Authorization: `Bearer ${makeToken(sub)}` };
  return {
    httpMethod: "GET",
    queryStringParameters: { ...queryStringParameters },
    headers
  };
}

// Example transaction
const baseTransaction = {
  success: true,
  status: "paid",
  trnId: "transaction_123",
  message: "a message",
  transaction: {
    pk: `transaction::${MOCK_BOOKING_ID}`,
    sk: `${DATE}::${TRANSACTION_ID}`,
    amount: 10,
    bookingId: 'standalone-test',
    clientTransactionId: 'TRANSACTION_ID',
    date: '${DATE}',
    globalId: 'TRANSACTION_ID',
    schema: 'transaction',
    sessionId: 'test-session-id',
    status: 'paid',
    userId: MOCK_USER_ID,
    cardAvsAddrMatch: 0,
    cardAvsId: 'U',
    cardAvsMessage: 'Address information is unavailable.',
    cardAvsPostalResult: 0,
    cardAvsProcessed: false,
    cardAvsResult: '0',
    cardBin: '433026',
    cardCvdId: '1',
    cardLastFour: '4675',
    cardType: 'VI',
    customRef1: 'standalone-test',
    customRef2: 'test-session-id',
    customRef3: '',
    customRef4: '',
    customRef5: '',
    trnAmount: 10,
    trnApproved: '1',
    trnAuthCode: 'TEST',
    trnCreated: `${DATE}T08:08:51`,
    trnId: 'worldline-trn-123',
    trnMessage: 'Approved',
    trnOrderNumber: `${TRANSACTION_ID}`,
    trnPaymentMethod: 'CC',
    trnRiskScore: 0,
    trnType: 'P',
    trnLinks: [
      {
        rel: 'void',
        href: 'https://api.na.bambora.com/v1/payments/worldline-trn-123/void',
        method: 'POST'
      },
      {
        rel: 'return',
        href: 'https://api.na.bambora.com/v1/payments/worldline-trn-123/returns',
        method: 'POST'
      }
    ],
    metadata: {}
  }
};

const baseTransactionsBooking = [
  baseTransaction,
  {
    transaction: {
      userId: MOCK_USER_ID,
    },
  },
]; 

const baseTransactionsBookingDate = [
  {
    transaction: {
      userId: MOCK_USER_ID,
    },
  },
  {
    transaction: {
      userId: MOCK_USER_ID,
    },
  },
]

describe("Admin Transaction GET handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTransactionsByBookingId.mockResolvedValue(baseTransactionsBooking);
    getTransactionsByBookingIdDate.mockResolvedValue(baseTransactionsBookingDate);
    getTransactionByTransactionId.mockResolvedValue(baseTransaction);

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("gets all transactions from a bookingId", async () => {
    const event = makeEvent({
      sub: MOCK_ADMIN_ID,
      queryStringParameters: { bookingId: MOCK_BOOKING_ID }
    });

    const result = await handler(event);

    expect(result).toEqual(baseTransactionsBooking);
  });
  
  it("gets all transactions from a bookingId and date", async () => {
    const date = new Date("2026-06-25T12:00:00Z").toISOString().split('T')[0]

    const event = makeEvent({
      sub: MOCK_ADMIN_ID,
      queryStringParameters: { bookingId: MOCK_BOOKING_ID, date: date }
    });

    const result = await handler(event);

    expect(result).toEqual(baseTransactionsBookingDate);
  });
  
  it("gets a transaction using a clientTransactionId", async () => {
    const event = makeEvent({
      sub: MOCK_ADMIN_ID,
      queryStringParameters: { bookingId: MOCK_BOOKING_ID, date: "2025-06-11", clientTransactionId: TRANSACTION_ID }
    });

    const result = await handler(event);

    expect(result).toEqual(baseTransaction);
  });

  it("fails if the no query string parameters are given", async () => {
    const event = makeEvent({
      sub: MOCK_ADMIN_ID,
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Invalid: missing bookingId, date, and/or clientTransactionId",
    );
  });

  it("fails if no admin user is provided", async () => {
    const event = makeEvent({
      sub: undefined
    });

    const result = await handler(event, {});

    expect(result.status).toBe(401);
    expect(result.error.message).toBe(
      "Unauthorized: Authentication required to GET a transaction",
    );
  });
});
