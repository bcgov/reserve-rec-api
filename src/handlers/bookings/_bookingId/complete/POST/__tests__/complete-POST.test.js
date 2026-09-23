"use strict";

// The complete handler's error path. A refused completion must reach the caller
// as the status the refusal carried — the catch used to read a binding scoped to
// the try, so it threw over the real error and every refusal surfaced as a 502.

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status, data, message, error, context,
  })),
}));

jest.mock("/opt/dynamodb", () => ({ batchTransactData: jest.fn() }));

const mockCompleteBooking = jest.fn();
jest.mock("../../../../methods", () => ({
  completeBooking: (...args) => mockCompleteBooking(...args),
  sendBookingConfirmationEmail: jest.fn(),
}));
jest.mock("../../../../notifications", () => ({ enqueueSmsReminderIfNeeded: jest.fn() }));

const { logger } = require("/opt/base");
const { handler } = require("../public");

const event = (body = { sessionId: "s-1" }) => ({
  pathParameters: { bookingId: "b-1" },
  body: JSON.stringify(body),
  requestContext: { authorizer: { userId: "sub-1" } },
});

describe("POST complete booking — error path", () => {
  beforeEach(() => jest.clearAllMocks());

  // The case seen in production: re-submitting a booking that already completed.
  it("returns the refusal's own status, not a crash", async () => {
    mockCompleteBooking.mockRejectedValue(
      Object.assign(new Error("Booking is not 'in progress' and cannot be completed"), { code: 400 })
    );

    const res = await handler(event(), {});

    expect(res.status).toBe(400);
    expect(res.message).toMatch(/not 'in progress'/);
  });

  it("names the booking in the failure log", async () => {
    mockCompleteBooking.mockRejectedValue(Object.assign(new Error("nope"), { code: 409 }));

    await handler(event(), {});

    expect(logger.error).toHaveBeenCalledWith(
      "event=booking_complete_failed",
      expect.objectContaining({ bookingId: "b-1", code: 409 })
    );
  });

  it("still answers when the body is not JSON", async () => {
    const res = await handler({ ...event(), body: "{" }, {});
    expect(res.status).toBe(400);
  });
});
