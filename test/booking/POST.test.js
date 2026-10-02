"use strict";

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code || null;
    this.data = data?.data || null;
  }),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
  getRequestClaimsFromEvent: jest.fn(() => ({ sub: "test-user-123" })),
}));

jest.mock("../../src/handlers/bookings/methods", () => ({
  createBooking: jest.fn(),
  formatBookingResponsePublic: jest.fn(),
}));

jest.mock("../../src/handlers/bookings/configs", () => ({
  BOOKING_PUT_CONFIG: {},
}));

jest.mock("/opt/dynamodb", () => ({
  TABLE_NAME: "TestTable",
  batchTransactData: jest.fn(),
  isTransactionConflict: jest.requireActual("/opt/dynamodb").isTransactionConflict,
}));

jest.mock("../../src/handlers/waiting-room/utils/token", () => ({
  parseAdmissionCookie: jest.fn(),
  validateToken: jest.fn(),
}));
jest.mock("../../src/handlers/waiting-room/utils/secrets", () => ({ getHmacSigningKey: jest.fn() }));
jest.mock("../../src/handlers/waiting-room/utils/dynamodb", () => ({
  getQueueMeta: jest.fn(),
  buildQueueId: jest.fn(() => "queue-1"),
}));

const { handler } = require("../../src/handlers/bookings/POST/public");
const { createBooking, formatBookingResponsePublic } = require("../../src/handlers/bookings/methods");
const { batchTransactData } = require("/opt/dynamodb");


describe("Bookings POST handler", () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 if body is missing", async () => {
    const event = { body: null };
    const result = await handler(event, context);
    expect(result.status).toBe(400);
    expect(result.message).toBe("Body is required");
  });

  it("should return 400 if required fields are missing", async () => {
    const event = { body: JSON.stringify({}) };
    const result = await handler(event, context);
    expect(result.status).toBe(400);
    expect(result.message).toMatch("Cannot create booking - missing required parameter(s): collectionId, activityType, activityId, startDate");
  });

  it("should create booking and return 200 on success", async () => {
    const body = {
      collectionId: "bcparks_123",
      activityType: "backcountryCamp",
      activityId: "1",
      productId: "product-1",
      startDate: "2024-01-01",
      quantity: 2,
      userId: "test-user-123",
    };
    const event = { body: JSON.stringify(body) };

    createBooking.mockResolvedValue({ requestItems: [{ booking: "data" }] });
    batchTransactData.mockResolvedValue({ result: "ok" });
    formatBookingResponsePublic.mockReturnValue({ bookingId: "booking-1" });

    const result = await handler(event, context);

    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: "bcparks_123",
        activityType: "backcountryCamp",
        activityId: "1",
        productId: "product-1",
        startDate: "2024-01-01",
        endDate: "2024-01-01",
        invQuantity: 2,
        userId: "test-user-123",
      })
    );
    expect(batchTransactData).toHaveBeenCalledWith([{ booking: "data" }]);
    expect(formatBookingResponsePublic).toHaveBeenCalledWith([{ booking: "data" }]);

    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
    const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
    expect(data).toEqual({ bookingId: "booking-1" });
  });

  it("should extract parameters from pathParameters and queryStringParameters", async () => {
    const body = { userId: "test-user-123" };
    const event = {
      body: JSON.stringify(body),
      pathParameters: {
        collectionId: "ac2",
        activityType: "type2",
        activityId: "id2",
        productId: "prod2",
        startDate: "2024-02-02",
      },
      queryStringParameters: {
        quantity: "3",
        endDate: "2024-02-04",
      },
    };

    createBooking.mockResolvedValue({ requestItems: [{ booking: "data2" }] });
    batchTransactData.mockResolvedValue({ result: "ok2" });
    formatBookingResponsePublic.mockReturnValue({ bookingId: "booking-2" });

    const result = await handler(event, context);

    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: "ac2",
        activityType: "type2",
        activityId: "id2",
        productId: "prod2",
        startDate: "2024-02-02",
        endDate: "2024-02-04",
        invQuantity: 3,
        userId: "test-user-123",
      })
    );
    expect(result.status).toBe(200);
    const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
    expect(data).toEqual({ bookingId: "booking-2" });
  });

  it("should handle errors thrown in try block", async () => {
    const body = {
      collectionId: "bcparks_123",
      activityType: "backcountry",
      activityId: "id1",
      productId: "product-1",
      startDate: "2024-01-01",
      quantity: 1,
      userId: "test-user-123",
    };
    const event = { body: JSON.stringify(body) };

    createBooking.mockRejectedValue(new Error("DB error"));

    const result = await handler(event, context);
    expect(result.status).toBe(400);
    expect(result.message).toBe("DB error");
  });

  describe("event logging", () => {
    const { logger } = require("/opt/base");
    const event = {
      body: JSON.stringify({
        collectionId: "bcparks_123", activityType: "backcountry", activityId: "id1",
        productId: "product-1", startDate: "2024-01-01", quantity: 1,
      }),
    };
    const eventNames = () => [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls]
      .map(([msg]) => msg).filter((msg) => typeof msg === "string" && msg.startsWith("event="));
    const refused = (refusal, code, data = {}) => Object.assign(new Error(`refused: ${refusal}`), {
      code, data: { ...data, refusal },
    });
    const duplicate = (status) => refused(status === "confirmed" ? "has_booking" : "has_hold", 409,
      { existingBookingId: "b-1", status });

    it("counts a success as hold_created alone", async () => {
      createBooking.mockResolvedValue({ requestItems: [{ booking: "data" }] });
      batchTransactData.mockResolvedValue({ result: "ok" });
      formatBookingResponsePublic.mockReturnValue({ bookingId: "booking-1" });
      const result = await handler(event, context);
      expect(result.status).toBe(200);
      expect(eventNames()).toEqual(["event=hold_created"]);
    });

    it("counts a refusal over a confirmed booking apart from failures", async () => {
      createBooking.mockRejectedValue(duplicate("confirmed"));
      const result = await handler(event, context);
      expect(result.status).toBe(409);
      expect(eventNames()).toEqual(["event=hold_refused_has_booking"]);
    });

    it("counts a refusal over an open hold apart from failures", async () => {
      createBooking.mockRejectedValue(duplicate("in progress"));
      await handler(event, context);
      expect(eventNames()).toEqual(["event=hold_refused_has_hold"]);
    });

    it("counts losing the hold-marker race as a refusal over an open hold", async () => {
      createBooking.mockResolvedValue({ requestItems: [{ data: { Put: { Item: { pk: { S: "bookinghold::u::c::a::i::p" } } } } }] });
      batchTransactData.mockRejectedValue(Object.assign(new Error("Transaction cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      }));
      const result = await handler(event, context);
      expect(result.status).toBe(409);
      expect(eventNames()).toEqual(["event=hold_refused_has_hold"]);
    });

    it("answers a write race on inventory with a 409 and counts it as a conflict", async () => {
      createBooking.mockResolvedValue({ requestItems: [{ data: {} }] });
      batchTransactData.mockRejectedValue(Object.assign(new Error("Transaction cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "TransactionConflict" }, { Code: "None" }],
      }));
      const result = await handler(event, context);
      expect(result.status).toBe(409);
      expect(result.message).toBe("This pass is in high demand right now. Please try again.");
      expect(eventNames()).toEqual(["event=hold_conflict"]);
    });

    describe("counts invalid requests as hold_refused_invalid", () => {
      const { getRequestClaimsFromEvent } = require("/opt/base");
      const withBody = (body) => ({ body: JSON.stringify({ ...JSON.parse(event.body), ...body }) });
      const cases = [
        ["a missing body", { body: null }],
        ["a body that is not JSON", { body: "{" }],
        ["a missing parameter", withBody({ productId: undefined })],
        ["a zero quantity", withBody({ quantity: 0 })],
        ["a quantity that is not a number", withBody({ quantity: "two" })],
        ["a negative quantity", withBody({ quantity: -1 })],
      ];

      it.each(cases)("%s", async (_, request) => {
        const result = await handler(request, context);
        expect(result.status).toBe(400);
        expect(result.data).toEqual({ refusal: "invalid" });
        expect(createBooking).not.toHaveBeenCalled();
        expect(eventNames()).toEqual(["event=hold_refused_invalid"]);
      });

      it("a request that is not signed in", async () => {
        getRequestClaimsFromEvent.mockReturnValueOnce(null);
        const result = await handler(event, context);
        expect(result.status).toBe(401);
        expect(result.data).toEqual({ refusal: "invalid" });
        expect(eventNames()).toEqual(["event=hold_refused_invalid"]);
      });
    });

    it.each([
      ["window", 400],
      ["invalid", 400],
      ["state", 400],
      ["not_found", 404],
      ["unverified_email", 403],
    ])("counts the %s refusal from createBooking as its own event", async (refusal, code) => {
      createBooking.mockRejectedValue(refused(refusal, code));
      const result = await handler(event, context);
      expect(result.status).toBe(code);
      expect(eventNames()).toEqual([`event=hold_refused_${refusal}`]);
    });

    it.each([
      ["bookingDate::c::a::i::p::2024-01-01", "Error initializing the booking dates."],
      ["booking::c::a::i::p", "Error creating the booking."],
    ])("counts a failed condition on %s as hold_conflict", async (pk, message) => {
      createBooking.mockResolvedValue({ requestItems: [{ data: { Put: { Item: { pk: { S: pk } } } } }] });
      batchTransactData.mockRejectedValue(Object.assign(new Error("Transaction cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      }));
      const result = await handler(event, context);
      expect(result.status).toBe(400);
      expect(result.message).toBe(message);
      expect(eventNames()).toEqual(["event=hold_conflict"]);
    });

    it("counts a failed inventory condition as sold out", async () => {
      createBooking.mockResolvedValue({ requestItems: [
        { data: { Put: { Item: { pk: { S: "booking::c::a::i::p" } } } } },
        { data: { Update: { Key: { pk: { S: "inventoryPool::c::a::i::p::2024-01-01" } } } } },
      ] });
      batchTransactData.mockRejectedValue(Object.assign(new Error("Transaction cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
      }));
      const result = await handler(event, context);
      expect(result.message).toBe("Booking item no longer available.");
      expect(eventNames()).toEqual(["event=hold_refused_sold_out"]);
    });

    describe("with the waiting room open", () => {
      const { parseAdmissionCookie } = require("../../src/handlers/waiting-room/utils/token");
      const { getHmacSigningKey } = require("../../src/handlers/waiting-room/utils/secrets");
      const { getQueueMeta } = require("../../src/handlers/waiting-room/utils/dynamodb");

      beforeEach(() => {
        process.env.WAITING_ROOM_TABLE_NAME = "waiting-room";
        process.env.HMAC_SIGNING_KEY_ARN = "hmac-key";
        getQueueMeta.mockResolvedValue({ queueStatus: "open" });
      });

      afterEach(() => {
        delete process.env.WAITING_ROOM_TABLE_NAME;
        delete process.env.HMAC_SIGNING_KEY_ARN;
      });

      it("counts a request without admission as a waiting-room refusal", async () => {
        parseAdmissionCookie.mockReturnValue(null);
        const result = await handler(event, context);
        expect(result.status).toBe(403);
        expect(result.data).toMatchObject({ waitingRoom: true, refusal: "waiting_room" });
        expect(eventNames()).toEqual(["event=hold_refused_waiting_room"]);
      });

      it("still counts a failure to read the signing key as hold_failed", async () => {
        parseAdmissionCookie.mockReturnValue("token");
        getHmacSigningKey.mockRejectedValue(new Error("secrets unavailable"));
        const result = await handler(event, context);
        expect(result.status).toBe(500);
        expect(eventNames()).toEqual(["event=hold_failed"]);
      });
    });

    describe("hold limit refusals", () => {
      const retryAt = "2026-06-10T18:09:00.000Z";
      const logFields = {
        userSub: "test-user-123", productKey: "bcparks_123::backcountry::id1::product-1", date: "2024-01-01",
        removedCount: 3, holdsLastHour: 4, holdsLastDay: 6, retryAt,
      };
      const limitRefusal = (refusal, code) => Object.assign(refused(refusal, 429, { code, retryAt }), {
        message: "Try later", logFields,
      });

      it.each([
        ["cooldown", "HOLD_COOLDOWN"],
        ["cap", "HOLD_CAP"],
      ])("logs event=hold_refused_%s with the limit fields", async (refusal, code) => {
        createBooking.mockRejectedValue(limitRefusal(refusal, code));
        const result = await handler(event, context);
        expect(result.status).toBe(429);
        expect(eventNames()).toEqual([`event=hold_refused_${refusal}`]);
        const [, payload] = logger.info.mock.calls.find(([msg]) => msg === `event=hold_refused_${refusal}`);
        expect(payload).toEqual(logFields);
      });

      it("answers 429 with msg, code and retryAt in the body", async () => {
        const { sendResponse } = require("/opt/base");
        sendResponse.mockImplementationOnce(jest.requireActual("../../src/layers/base/base.js").sendResponse);
        createBooking.mockRejectedValue(limitRefusal("cooldown", "HOLD_COOLDOWN"));
        const result = await handler(event, context);
        expect(result.statusCode).toBe(429);
        expect(JSON.parse(result.body)).toMatchObject({ msg: "Try later", code: "HOLD_COOLDOWN", retryAt });
      });
    });

    it("adds holdLimits to the hold response", async () => {
      createBooking.mockResolvedValue({ requestItems: [{ booking: "data" }], holdLimits: { freeRemovalsLeft: 2 } });
      batchTransactData.mockResolvedValue({ result: "ok" });
      formatBookingResponsePublic.mockReturnValue({ bookingId: "booking-1" });
      const result = await handler(event, context);
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ bookingId: "booking-1", holdLimits: { freeRemovalsLeft: 2 } });
    });

    it("still counts any other error as hold_failed", async () => {
      createBooking.mockRejectedValue(new Error("DB error"));
      await handler(event, context);
      expect(eventNames()).toEqual(["event=hold_failed"]);
    });

    it("logs the booking item's bookingId, not the first (bookingDate) item's", async () => {
      createBooking.mockResolvedValue({ requestItems: [
        { data: { Item: { schema: { S: "bookingDate" }, bookingId: { S: "wrong-id" } } } },
        { data: { Item: { schema: { S: "booking" }, bookingId: { S: "booking-1" } } } },
      ] });
      batchTransactData.mockResolvedValue({ result: "ok" });
      formatBookingResponsePublic.mockReturnValue({ bookingId: "booking-1" });

      await handler(event, context);

      const [, payload] = logger.info.mock.calls.find(([msg]) => msg === "event=hold_created");
      expect(payload.bookingId).toBe("booking-1");
    });
  });
});
