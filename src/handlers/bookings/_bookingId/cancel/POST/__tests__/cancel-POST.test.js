"use strict";

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
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
  calculatePartySize: jest.fn(() => 4),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  batchWriteData: jest.fn(),
  marshall: jest.fn((value) => value),
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../../../../bookings/methods", () => ({
  flagCancelledBooking: jest.fn(),
  getBookingByBookingId: jest.fn(),
  generateEmailParams: jest.fn(),
  sendBookingCancellationEmail: jest.fn(),
}));

const BOOKING_ID = "booking-123";
const MOCK_USER_ID = "123"

const { handler } = require("../index");
const {
  getBookingByBookingId,
  flagCancelledBooking,
  generateEmailParams,
  sendBookingCancellationEmail,
} = require("../../../../../bookings/methods");
const { batchTransactData } = require("/opt/dynamodb");

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({ bookingId = "booking-123", sub = MOCK_USER_ID, body = {} } = {}) {
  const headers = sub ? { Authorization: `Bearer ${makeToken(sub)}` } : {};
  return {
    httpMethod: "PUT",
    pathParameters: { bookingId },
    body: JSON.stringify(body),
    headers,
  };
}

const baseBooking = {
  bookingId: BOOKING_ID,
  status: "confirmed",
  pk: "booking::1",
  sk: "1",
  userId: MOCK_USER_ID,
  reservationContext: {
    checkInTime: new Date("2026-06-11T08:00:00Z").getTime(), // Window starts
    checkOutTime: new Date("2026-06-11T20:00:00Z").getTime(),  // Window ends
  }
};

describe("Bookings Cancel handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation
    getBookingByBookingId.mockResolvedValue({ ...baseBooking });
    flagCancelledBooking.mockResolvedValue({});
    generateEmailParams.mockResolvedValue({});
    sendBookingCancellationEmail.mockResolvedValue({});
    batchTransactData.mockResolvedValue({});

    // Mock current time to 12pm on June 11, 2026
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns 200 for OPTIONS request", async () => {
    const result = await handler({ httpMethod: "OPTIONS" }, {});
    expect(result.status).toBe(200);
  });

  it("returns 400 when bookingId is missing", async () => {
    const event = makeEvent({ bookingId: '' });
    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("Booking ID required");
  });

  it("returns 401 when there is no auth token", async () => {
    const event = makeEvent({ sub: null });
    const result = await handler(event, {});
    expect(result.status).toBe(401);
    expect(result.message).toContain("Unauthorized");
  });

  it("returns 401 when userId is missing", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: "pending" });
    const event = makeEvent({sub: ''});
    const result = await handler(event, {});
    expect(result.status).toBe(401);
    expect(result.message).toContain('User ID not found in request claims');
  });

  it("returns 403 when userId doesn't match", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: "pending" });
    const event = makeEvent({sub: 'something-else'});
    const result = await handler(event, {});
    expect(result.status).toBe(403);
    expect(result.message).toContain('does not own booking');
  });

  it("returns 409 when booking is already cancelled", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: 'cancelled' });
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(409);
    expect(result.message).toContain("is already cancelled");
  });

  it("returns 409 when booking is already checked-in", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, checkedInTime: 123123123 });
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(409);
    expect(result.message).toContain("is already checked-in");
  });

  it("returns 409 when booking status isn't confirmed or in-progress", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: 'something' });
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(409);
    expect(result.message).toContain("Booking has status \"something\" and cannot be cancelled");
  });

  it("allows in-progress bookings to be cancelled", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: 'in progress' });
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
    expect(flagCancelledBooking).toHaveBeenCalledTimes(1);
    expect(batchTransactData).toHaveBeenCalledTimes(1);
  });

  it("rejects cancellations after checkout time", async () => {
    getBookingByBookingId.mockResolvedValue({
      ...baseBooking,
      reservationContext: { ...baseBooking.reservationContext, checkOutTime: new Date("2026-06-11T11:00:00Z").getTime() },
    });

    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("cannot be cancelled after the checkout time");
  });

  it("sanitizes and truncates the reason before cancelling", async () => {
    const event = makeEvent({
      body: { reason: "This is a\x00bad\x01reason\nwith control chars\u0008 and a long string" },
    });

    await handler(event, {});
    expect(flagCancelledBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID }),
      expect.any(Number),
      expect.stringContaining("This is a"),
      MOCK_USER_ID,
    );
    const [, , reason] = flagCancelledBooking.mock.calls[0];
    expect(reason).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    expect(reason.length).toBeLessThanOrEqual(1000);
  });

  it("returns 400 when a second cancellation races the conditional write", async () => {
    const error = {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      code: 400,
      message: "The transaction was canceled",
    };
    flagCancelledBooking.mockRejectedValue(error);

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(400);
    expect(result.message).toBe("Booking is already cancelled");
  });

  it("succeeds and queues the cancellation email", async () => {
    const emailParams = { bookingId: BOOKING_ID, recipient: "user@example.com" };
    generateEmailParams.mockResolvedValue(emailParams);
    sendBookingCancellationEmail.mockResolvedValue({ success: true });

    const result = await handler(makeEvent({}), {});
    expect(result.status).toBe(200);
    expect(generateEmailParams).toHaveBeenCalledWith(expect.objectContaining({ bookingId: BOOKING_ID }));
    expect(sendBookingCancellationEmail).toHaveBeenCalledWith(emailParams, MOCK_USER_ID);
  });
});
