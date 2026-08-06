"use strict";

jest.mock("/opt/base", () => {
  const mockException = jest.fn(function (message, options) {
    this.message = message;
    this.msg = message;
    this.code = options?.code;
    this.data = options?.data || null;
    this.error = options?.error || null;
  });

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
    handleCORS: jest.fn((event) => {
      if (event?.httpMethod === "OPTIONS") {
        return { status: 200, body: "CORS OK" };
      }
      return null;
    }),
  };
});

jest.mock("../../../../methods", () => ({
  getAllRefundsByBookingId: jest.fn(),
  getRefundByRefundId: jest.fn(),
}));

const optBase = require("/opt/base");
const {
  getAllRefundsByBookingId,
  getRefundByRefundId,
} = require("../../../../methods");

const { handler } = require("../admin");

const MOCK_BOOKING_ID = "booking-123";
const MOCK_REFUND_ID = "ref-456";
const MOCK_ADMIN_ID = "admin-123";

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({
  httpMethod = "GET",
  pathParameters = null,
  queryStringParameters = null,
  sub = MOCK_ADMIN_ID,
} = {}) {
  const headers = sub ? { Authorization: `Bearer ${makeToken(sub)}` } : {};
  return {
    httpMethod,
    pathParameters,
    queryStringParameters,
    headers,
  };
}

const baseRefundList = [
  {
    refundTransactionId: "ref-456",
    bookingId: MOCK_BOOKING_ID,
    refundAmount: 5,
    status: "refunded",
  },
  {
    refundTransactionId: "ref-789",
    bookingId: MOCK_BOOKING_ID,
    refundAmount: 10,
    status: "refunded",
  },
];

const baseSingleRefund = {
  refundTransactionId: MOCK_REFUND_ID,
  bookingId: MOCK_BOOKING_ID,
  refundAmount: 5,
  status: "refunded",
};

describe("Admin Refunds GET handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getAllRefundsByBookingId.mockResolvedValue(baseRefundList);
    getRefundByRefundId.mockResolvedValue(baseSingleRefund);

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns CORS response for OPTIONS preflight request", async () => {
    const event = makeEvent({ httpMethod: "OPTIONS" });

    const result = await handler(event, {});

    expect(result).toEqual({ status: 200, body: "CORS OK" });
    expect(optBase.handleCORS).toHaveBeenCalledWith(event, {});
  });

  // Happy paths
  it("gets all refunds for a bookingId using pathParameters", async () => {
    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual(baseRefundList);
    expect(result.message).toBe("Success");
    expect(getAllRefundsByBookingId).toHaveBeenCalledWith(
      MOCK_BOOKING_ID,
      undefined
    );
  });

  it("gets all refunds for a bookingId using queryStringParameters", async () => {
    const event = makeEvent({
      queryStringParameters: { bookingId: MOCK_BOOKING_ID },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual(baseRefundList);
    expect(getAllRefundsByBookingId).toHaveBeenCalledWith(
      MOCK_BOOKING_ID,
      undefined
    );
  });

  it("gets a specific refund using bookingId and refundId using pathParameters", async () => {
    const event = makeEvent({
      pathParameters: {
        bookingId: MOCK_BOOKING_ID,
        refundId: MOCK_REFUND_ID,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual(baseSingleRefund);
    expect(getRefundByRefundId).toHaveBeenCalledWith(
      MOCK_BOOKING_ID,
      MOCK_REFUND_ID
    );
  });

  it("gets a specific refund using bookingId and refundId using queryStringParameters", async () => {
    const event = makeEvent({
      queryStringParameters: {
        bookingId: MOCK_BOOKING_ID,
        refundId: MOCK_REFUND_ID,
      },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual(baseSingleRefund);
    expect(getRefundByRefundId).toHaveBeenCalledWith(
      MOCK_BOOKING_ID,
      MOCK_REFUND_ID
    );
  });

  // Validation checks
  it("fails with 400 if bookingId is missing from both path and query parameters", async () => {
    const event = makeEvent({
      queryStringParameters: { refundId: MOCK_REFUND_ID }, // missing bookingId
    });

    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.message).toBe("Required items are missing");
  });

  it("handles errors thrown by database/method layer gracefully", async () => {
    getAllRefundsByBookingId.mockRejectedValueOnce(
      new optBase.Exception("Failed to query database", { code: 500 })
    );

    const event = makeEvent({
      pathParameters: { bookingId: MOCK_BOOKING_ID },
    });

    const result = await handler(event, {});

    expect(result.status).toBe(500);
    expect(result.message).toBe("Failed to query database");
  });
});
