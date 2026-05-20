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
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
}));

jest.mock("../../src/handlers/bookings/methods", () => ({
  getBookingByBookingId: jest.fn(),
  flagCancelledBooking: jest.fn(),
  generateEmailParams: jest.fn(),
  sendBookingCancellationEmail: jest.fn(),
}));

const { handler } = require("../../src/handlers/bookings/_bookingId/cancel/POST/index");
const {
  getBookingByBookingId,
  flagCancelledBooking,
  generateEmailParams,
  sendBookingCancellationEmail,
} = require("../../src/handlers/bookings/methods");
const { batchTransactData } = require("/opt/dynamodb");

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({ bookingId = "booking-123", sub = "user-456", body = {} } = {}) {
  return {
    httpMethod: "POST",
    pathParameters: { bookingId },
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${makeToken(sub)}` },
  };
}

const SUB = "user-456";
const BOOKING_ID = "booking-123";
const okBooking = {
  bookingId: BOOKING_ID,
  userId: SUB,
  status: "confirmed",
  pk: "booking::1",
  sk: "1",
};

describe("Bookings Cancel POST handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    flagCancelledBooking.mockResolvedValue([{ action: "Update", data: {} }]);
    generateEmailParams.mockResolvedValue({
      booking: { bookingId: BOOKING_ID },
      customer: {},
      location: {},
      branding: {},
    });
    sendBookingCancellationEmail.mockResolvedValue({ messageId: "msg-1" });
    batchTransactData.mockResolvedValue({ MessageId: "txn-1" });
  });

  it("returns 200 for OPTIONS request", async () => {
    const result = await handler({ httpMethod: "OPTIONS" }, {});
    expect(result.status).toBe(200);
  });

  it("returns 401 when there is no auth token", async () => {
    const result = await handler({
      httpMethod: "POST",
      pathParameters: { bookingId: BOOKING_ID },
      body: "{}",
      headers: {},
    }, {});
    expect(result.status).toBe(401);
  });

  it("returns 400 when bookingId is missing", async () => {
    const result = await handler({
      httpMethod: "POST",
      pathParameters: {},
      body: "{}",
      headers: { Authorization: `Bearer ${makeToken(SUB)}` },
    }, {});
    expect(result.status).toBe(400);
    expect(result.message).toBe("Booking ID required in request");
  });

  it("returns 403 when the caller does not own the booking", async () => {
    getBookingByBookingId.mockResolvedValue({ ...okBooking, userId: "someone-else" });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(403);
    expect(result.message).toContain("does not own booking");
  });

  it("rejects bookings that aren't in a cancellable state", async () => {
    getBookingByBookingId.mockResolvedValue({ ...okBooking, status: "completed" });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/cannot be cancelled/);
  });

  it("rejects 'in progress' bookings (only confirmed are cancellable here)", async () => {
    getBookingByBookingId.mockResolvedValue({ ...okBooking, status: "in progress" });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/cannot be cancelled/);
    expect(flagCancelledBooking).not.toHaveBeenCalled();
  });

  it("caps an oversized reason at 1000 chars before passing it down", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);
    const longReason = "x".repeat(5000);

    await handler(makeEvent({ body: { reason: longReason } }), {});

    const passedReason = flagCancelledBooking.mock.calls[0][2];
    expect(passedReason.length).toBe(1000);
  });

  it("strips ASCII control characters from the reason", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);
    const dirty = "valid\x00reason\x07with\x1Fcontrols";

    await handler(makeEvent({ body: { reason: dirty } }), {});

    const passedReason = flagCancelledBooking.mock.calls[0][2];
    expect(passedReason).toBe("validreasonwithcontrols");
  });

  it("treats an empty/whitespace-only reason as no reason", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);

    await handler(makeEvent({ body: { reason: "   " } }), {});

    expect(flagCancelledBooking).toHaveBeenCalledWith(
      okBooking,
      expect.any(Number),
      undefined,
      SUB
    );
  });

  it("cancels and queues a cancellation email on success", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);

    const result = await handler(makeEvent(), {});

    expect(flagCancelledBooking).toHaveBeenCalledWith(okBooking, expect.any(Number), undefined, SUB);
    expect(batchTransactData).toHaveBeenCalled();
    expect(sendBookingCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ booking: { bookingId: BOOKING_ID } }),
      SUB
    );
    expect(result.status).toBe(200);
    expect(result.data.bookingId).toBe(BOOKING_ID);
  });

  it("forwards the user-supplied reason to flagCancelledBooking", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);

    const result = await handler(
      makeEvent({ body: { reason: "Trip cancelled due to weather" } }),
      {}
    );

    expect(flagCancelledBooking).toHaveBeenCalledWith(
      okBooking,
      expect.any(Number),
      "Trip cancelled due to weather",
      SUB
    );
    expect(result.status).toBe(200);
  });

  it("still returns 200 if the cancellation email fails to queue", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);
    sendBookingCancellationEmail.mockRejectedValue(new Error("SQS down"));

    const result = await handler(makeEvent(), {});

    expect(batchTransactData).toHaveBeenCalled();
    expect(result.status).toBe(200);
  });

  it("returns 400 'already cancelled' when ConditionExpression fails (race)", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);
    const txErr = new Error("Transaction cancelled");
    txErr.name = "TransactionCanceledException";
    txErr.CancellationReasons = [{ Code: "ConditionalCheckFailed" }];
    batchTransactData.mockRejectedValue(txErr);

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(400);
    expect(result.message).toBe("Booking is already cancelled");
    expect(sendBookingCancellationEmail).not.toHaveBeenCalled();
  });

  it("propagates other TransactionCanceled reasons as generic errors", async () => {
    getBookingByBookingId.mockResolvedValue(okBooking);
    const txErr = new Error("Some other reason");
    txErr.name = "TransactionCanceledException";
    txErr.CancellationReasons = [{ Code: "ValidationError" }];
    batchTransactData.mockRejectedValue(txErr);

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(400);
    expect(result.message).not.toBe("Booking is already cancelled");
  });
});
