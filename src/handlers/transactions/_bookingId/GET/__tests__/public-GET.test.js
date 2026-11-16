"use strict";

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
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

jest.mock("../../../methods", () => ({
  getTransactionsByBookingId: jest.fn(),
  getTransactionsByBookingIdDate: jest.fn(),
  findAndVerifyTransactionOwnership: jest.fn(),
}));

const { handler } = require("../public");
const {
  findAndVerifyTransactionOwnership,
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate
} = require("../../../methods");

const MOCK_BOOKING_ID = "booking-123";
const MOCK_USER_ID = "user-123";
const TRANSACTION_ID = `BCPR-${MOCK_BOOKING_ID}`
const DATE = new Date("2026-06-11T12:00:00Z").toISOString().split('T')[0]

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({ sub, pathParameters = {}, queryStringParameters = {} }) {
  const headers = { Authorization: `Bearer ${makeToken(sub)}` };
  return {
    httpMethod: "GET",
    pathParameters: { ...pathParameters },
    queryStringParameters: { ...queryStringParameters },
    headers
  };
}

// Transactions are stored flat: userId sits on the item itself.
const baseTransaction = {
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
};

const mine = { ...baseTransaction, sk: "mine-2" };
const notMine = { ...baseTransaction, sk: "not-mine", userId: "not-the-right-user" };

describe("Public Transaction GET handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTransactionsByBookingId.mockResolvedValue({ items: [baseTransaction, mine, notMine] });
    getTransactionsByBookingIdDate.mockResolvedValue({ items: [baseTransaction, notMine] });
    findAndVerifyTransactionOwnership.mockResolvedValue(baseTransaction);
  });

  it("returns only the caller's transactions for a bookingId", async () => {
    const event = makeEvent({
      sub: MOCK_USER_ID,
      pathParameters: { bookingId: MOCK_BOOKING_ID }
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual([baseTransaction, mine]);
  });

  it("returns only the caller's transactions for a bookingId and date", async () => {
    const event = makeEvent({
      sub: MOCK_USER_ID,
      pathParameters: { bookingId: MOCK_BOOKING_ID },
      queryStringParameters: { date: DATE }
    });

    const result = await handler(event, {});

    expect(getTransactionsByBookingIdDate).toHaveBeenCalledWith(MOCK_BOOKING_ID, DATE);
    expect(result.status).toBe(200);
    expect(result.data).toEqual([baseTransaction]);
  });

  it("gets the caller's transaction using a clientTransactionId", async () => {
    const event = makeEvent({
      sub: MOCK_USER_ID,
      queryStringParameters: { clientTransactionId: TRANSACTION_ID }
    });

    const result = await handler(event, {});

    expect(findAndVerifyTransactionOwnership).toHaveBeenCalledWith(TRANSACTION_ID, MOCK_USER_ID);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(baseTransaction);
  });

  it("refuses a clientTransactionId the caller does not own", async () => {
    const { Exception } = require("/opt/base");
    findAndVerifyTransactionOwnership.mockRejectedValue(
      new Exception("Unauthorized access to transaction", { code: 401 }),
    );
    const event = makeEvent({
      sub: MOCK_USER_ID,
      queryStringParameters: { clientTransactionId: TRANSACTION_ID }
    });

    const result = await handler(event, {});

    expect(result.status).toBe(401);
    expect(result.data).toBeNull();
  });

  it("fails if the no query string parameters are given", async () => {
    const event = makeEvent({
      sub: MOCK_USER_ID,
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.error.message).toBe(
      "Invalid: missing bookingId, date, and/or clientTransactionId",
    );
  });

  it("fails if no user is provided", async () => {
    const event = makeEvent({
      sub: undefined
    });

    const result = await handler(event, {});

    expect(result.status).toBe(401);
    expect(result.error.message).toBe(
      "Unauthorized: a valid userId is required",
    );
  });
});
