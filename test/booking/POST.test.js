"use strict";

jest.mock("/opt/base", () => ({
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
}));

jest.mock("../../src/handlers/bookings/configs", () => ({
  BOOKING_PUT_CONFIG: {},
}));

jest.mock("/opt/data-utils", () => ({
  quickApiPutHandler: jest.fn(),
}));

jest.mock("/opt/dynamodb", () => ({
  TABLE_NAME: "TestTable",
  batchTransactData: jest.fn(),
}));

const { handler } = require("../../src/handlers/bookings/POST/public");
const { createBooking } = require("../../src/handlers/bookings/methods");
const { quickApiPutHandler } = require("/opt/data-utils");
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
    expect(result.message).toMatch(/Activity Collection ID/);
  });

  it("should create booking and return 200 on success", async () => {
    const body = {
      collectionId: "bcparks_123",
      activityType: "backcountryCamp",
      activityId: "1",
      startDate: "2024-01-01",
      user: "test-user-123",
    };
    const event = { body: JSON.stringify(body) };

    createBooking.mockResolvedValue([{ booking: "data" }]);
    quickApiPutHandler.mockResolvedValue([{ put: "item" }]);
    batchTransactData.mockResolvedValue({ result: "ok" });

    const result = await handler(event, context);

    expect(createBooking).toHaveBeenCalledWith(
      "bcparks_123",
      "backcountryCamp",
      "1",
      "2024-01-01",
      expect.objectContaining({
        collectionId: "bcparks_123",
        activityType: "backcountryCamp",
        activityId: "1",
        startDate: "2024-01-01",
        user: "test-user-123",
        userId: "test-user-123"
      })
    );
    expect(quickApiPutHandler).toHaveBeenCalled();
    expect(batchTransactData).toHaveBeenCalled();

    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
    const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
    expect(data.booking).toEqual([{ booking: "data" }]);
    expect(data.res).toEqual({ result: "ok" });
  });

  it("should extract parameters from pathParameters and queryStringParameters", async () => {
    const body = { user: "test-user-123" };
    const event = {
      body: JSON.stringify(body),
      pathParameters: {
        collectionId: "ac2",
        activityType: "type2",
        activityId: "id2",
        startDate: "2024-02-02",
      },
    };

    createBooking.mockResolvedValue([{ booking: "data2" }]);
    quickApiPutHandler.mockResolvedValue([{ put: "item2" }]);
    batchTransactData.mockResolvedValue({ result: "ok2" });

    const result = await handler(event, context);

    expect(createBooking).toHaveBeenCalledWith(
      "ac2",
      "type2",
      "id2",
      "2024-02-02",
      expect.objectContaining({
        user: "test-user-123",
        userId: "test-user-123"
      })
    );
    expect(result.status).toBe(200);
    const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
    expect(data.booking).toEqual([{ booking: "data2" }]);
  });

  it("should handle errors thrown in try block", async () => {
    const body = {
      collectionId: "bcparks_123",
      activityType: "backcountry",
      activityId: "id1",
      startDate: "2024-01-01",
      user: "test-user-123",
    };
    const event = { body: JSON.stringify(body) };

    createBooking.mockRejectedValue(new Error("DB error"));

    const result = await handler(event, context);
    expect(result.status).toBe(400);
    expect(result.message).toBe("DB error");
  });
});
