"use strict";

// The complete handler's error path. A refused completion must reach the caller
// as the status the refusal carried — the catch used to read a binding scoped to
// the try, so it threw over the real error and every refusal surfaced as a 502.

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data?.data || null;
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

  describe("outcome events", () => {
    const eventNames = () => [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]
      .map(([msg]) => msg).filter((msg) => typeof msg === "string" && msg.startsWith("event="));
    const refused = (refusal, code) => Object.assign(new Error(`refused: ${refusal}`), { code, data: { refusal } });

    it.each([
      ["state", 400],
      ["owner", 403],
      ["not_found", 400],
      ["invalid", 400],
      ["unverified_email", 403],
    ])("counts the %s refusal as its own event and not as a failure", async (refusal, code) => {
      mockCompleteBooking.mockRejectedValue(refused(refusal, code));

      const res = await handler(event(), {});

      expect(res.status).toBe(code);
      expect(eventNames()).toEqual([`event=complete_refused_${refusal}`]);
    });

    it.each([
      ["a body that is not JSON", { ...event(), body: "{" }, 400],
      ["a missing body", { ...event(), body: null }, 400],
      ["a missing session id", event({}), 400],
      ["a missing booking id", { ...event(), pathParameters: {} }, 400],
      ["no signed-in user", { ...event(), requestContext: {} }, 401],
    ])("counts %s as complete_refused_invalid", async (_, request, status) => {
      const res = await handler(request, {});

      expect(res.status).toBe(status);
      expect(res.data).toEqual({ refusal: "invalid" });
      expect(mockCompleteBooking).not.toHaveBeenCalled();
      expect(eventNames()).toEqual(["event=complete_refused_invalid"]);
    });

    it("counts a fault as booking_complete_failed", async () => {
      mockCompleteBooking.mockRejectedValue(new Error("DynamoDB unavailable"));

      await handler(event(), {});

      expect(eventNames()).toEqual(["event=booking_complete_failed"]);
    });

    it("counts a success as booking_completed alone", async () => {
      mockCompleteBooking.mockResolvedValue({ updateRequests: [], emailParams: {}, smsParams: {} });

      const res = await handler(event(), {});

      expect(res.status).toBe(200);
      expect(eventNames()).toEqual(["event=booking_completed"]);
    });
  });

  it("still answers when the body is not JSON", async () => {
    const res = await handler({ ...event(), body: "{" }, {});
    expect(res.status).toBe(400);
  });
});
