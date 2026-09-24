"use strict";

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn() },
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

    createBooking.mockResolvedValue([{ booking: "data" }]);
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

    createBooking.mockResolvedValue([{ booking: "data2" }]);
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
    const eventNames = () => [...logger.info.mock.calls, ...logger.error.mock.calls]
      .map(([msg]) => msg).filter((msg) => typeof msg === "string" && msg.startsWith("event="));
    const duplicate = (status) => Object.assign(new Error(`You already have a ${status} booking`), {
      code: 409, data: { existingBookingId: "b-1", status },
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
      createBooking.mockResolvedValue([{ data: { Put: { Item: { pk: { S: "bookinghold::u::c::a::i::p" } } } } }]);
      batchTransactData.mockRejectedValue(Object.assign(new Error("Transaction cancelled"), {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      }));
      const result = await handler(event, context);
      expect(result.status).toBe(409);
      expect(eventNames()).toEqual(["event=hold_refused_has_hold"]);
    });

    it("still counts any other error as hold_failed", async () => {
      createBooking.mockRejectedValue(new Error("DB error"));
      await handler(event, context);
      expect(eventNames()).toEqual(["event=hold_failed"]);
    });
  });
});
