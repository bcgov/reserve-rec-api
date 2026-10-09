"use strict";

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data?.data || null;
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
    } catch {
      return null;
    }
  }),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  isConditionFailure: jest.fn((error) =>
    error?.name === "TransactionCanceledException"
    && (error.CancellationReasons || []).some((reason) => reason?.Code === "ConditionalCheckFailed")
  ),
}));

jest.mock("../../../../../bookings/methods", () => ({
  cartRemovalRefusal: jest.fn((status) => {
    const error = new Error(`Booking has status "${status}" and cannot be removed from the cart`);
    error.code = 409;
    error.data = { status, refusal: "state" };
    return error;
  }),
  getBookingByBookingId: jest.fn(),
  flagCancelledBooking: jest.fn(),
  deleteBookingHoldMarker: jest.fn(),
}));

const BOOKING_ID = "booking-123";
const USER_ID = "user-123";

const { handler } = require("../public");
const {
  cartRemovalRefusal,
  getBookingByBookingId,
  flagCancelledBooking,
  deleteBookingHoldMarker,
} = require("../../../../../bookings/methods");
const { batchTransactData } = require("/opt/dynamodb");

function makeEvent({ bookingId = BOOKING_ID, sub = USER_ID } = {}) {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return {
    httpMethod: "POST",
    pathParameters: { bookingId },
    headers: sub ? { Authorization: `Bearer header.${payload}.signature` } : {},
  };
}

const inProgressBooking = {
  bookingId: BOOKING_ID,
  status: "in progress",
  pk: "booking::1",
  sk: "1",
  userId: USER_ID,
};

describe("Bookings Remove handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBookingByBookingId.mockResolvedValue({ ...inProgressBooking });
    flagCancelledBooking.mockResolvedValue([]);
    deleteBookingHoldMarker.mockReturnValue({ action: "Delete", data: { Key: {} } });
    batchTransactData.mockResolvedValue(true);
  });

  it("removes an in-progress booking and releases its hold marker", async () => {
    const context = {};
    const result = await handler(makeEvent(), context);

    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
    expect(result.data).toEqual({ message: "Booking removed", bookingId: BOOKING_ID });
    expect(flagCancelledBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, status: "in progress" }),
      expect.any(Number),
      undefined,
      USER_ID,
      { requireInProgress: true },
    );
    expect(batchTransactData).toHaveBeenCalledTimes(2);
    expect(deleteBookingHoldMarker).toHaveBeenCalledWith(inProgressBooking);
  });

  it("refuses to remove a confirmed booking", async () => {
    getBookingByBookingId.mockResolvedValue({ ...inProgressBooking, status: "confirmed" });

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(409);
    expect(cartRemovalRefusal).not.toHaveBeenCalled();
    expect(flagCancelledBooking).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});
