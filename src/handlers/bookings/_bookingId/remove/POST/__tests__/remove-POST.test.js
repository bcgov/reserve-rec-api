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
  flagRemovedBooking: jest.fn(),
  deleteBookingHoldMarker: jest.fn(),
}));

const BOOKING_ID = "booking-123";
const USER_ID = "user-123";

const { handler } = require("../public");
const { logger } = require("/opt/base");
const {
  cartRemovalRefusal,
  getBookingByBookingId,
  flagRemovedBooking,
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
    flagRemovedBooking.mockResolvedValue([]);
    deleteBookingHoldMarker.mockReturnValue({ action: "Delete", data: { Key: {} } });
    batchTransactData.mockResolvedValue(true);
  });

  it("removes an in-progress booking and releases its hold marker", async () => {
    const context = {};
    const result = await handler(makeEvent(), context);

    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
    expect(result.data).toEqual({ message: "Booking removed", bookingId: BOOKING_ID });
    expect(flagRemovedBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, status: "in progress" }),
      expect.any(Number),
      USER_ID
    );
    expect(batchTransactData).toHaveBeenCalledTimes(2);
    expect(deleteBookingHoldMarker).toHaveBeenCalledWith(inProgressBooking);
  });

  it("refuses to remove a confirmed booking", async () => {
    getBookingByBookingId.mockResolvedValue({ ...inProgressBooking, status: "confirmed" });

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(409);
    expect(cartRemovalRefusal).not.toHaveBeenCalled();
    expect(flagRemovedBooking).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("event=remove_refused_state", expect.any(Object));
  });

  it("answers a CORS preflight without touching the booking", async () => {
    const result = await handler({ httpMethod: "OPTIONS" }, {});

    expect(result.status).toBe(200);
    expect(getBookingByBookingId).not.toHaveBeenCalled();
  });

  it("returns 401 when the request carries no user", async () => {
    const result = await handler(makeEvent({ sub: null }), {});

    expect(result.status).toBe(401);
    expect(getBookingByBookingId).not.toHaveBeenCalled();
  });

  it("returns 400 when the path has no bookingId", async () => {
    const result = await handler(makeEvent({ bookingId: "" }), {});

    expect(result.status).toBe(400);
    expect(result.message).toBe("Booking ID required in request");
  });

  it("refuses to remove another user's booking", async () => {
    getBookingByBookingId.mockResolvedValue({ ...inProgressBooking, userId: "someone-else" });

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(403);
    expect(result.data).toEqual({ refusal: "owner" });
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  const conditionFailure = () => Object.assign(new Error("Transaction cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
  });

  it("explains the new status when the booking left 'in progress' before the write", async () => {
    batchTransactData.mockRejectedValueOnce(conditionFailure());
    getBookingByBookingId
      .mockResolvedValueOnce({ ...inProgressBooking })
      .mockResolvedValueOnce({ ...inProgressBooking, status: "confirmed" });

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(409);
    expect(result.data).toEqual({ status: "confirmed", refusal: "state" });
    expect(cartRemovalRefusal).toHaveBeenCalledWith("confirmed");
    expect(deleteBookingHoldMarker).not.toHaveBeenCalled();
  });

  it("returns 409 when the write raced but the booking still reads 'in progress'", async () => {
    batchTransactData.mockRejectedValueOnce(conditionFailure());

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(409);
    expect(result.message).toBe("Booking could not be removed because its status changed");
    expect(logger.info).toHaveBeenCalledWith("event=remove_refused_state", expect.any(Object));
  });

  it("surfaces a write failure that is not a condition failure", async () => {
    batchTransactData.mockRejectedValueOnce(Object.assign(new Error("throttled"), { code: 503 }));

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(503);
    expect(getBookingByBookingId).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("event=remove_failed", expect.objectContaining({ code: 503 }));
  });

  it("still reports success when the hold marker cannot be deleted", async () => {
    batchTransactData.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("marker gone"));

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to delete booking-hold marker on cancel",
      { bookingId: BOOKING_ID, error: "marker gone" }
    );
  });
});
