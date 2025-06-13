// lib/handlers/bookings/POST/index.test.js
"use strict";


jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
  }),
  logger: { info: jest.fn() },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
}));

jest.mock("/opt/bookings/methods", () => ({
  createBooking: jest.fn(),
}));

jest.mock("/opt/bookings/configs", () => ({
  BOOKING_PUT_CONFIG: {},
}));

jest.mock("/opt/data-utils", () => ({
  quickApiPutHandler: jest.fn(),
}));

jest.mock("/opt/dynamodb", () => ({
  TABLE_NAME: "TestTable",
  batchTransactData: jest.fn(),
}));

const { handler } = require("../lib/handlers/bookings/POST/index");
const { createBooking } = require("/opt/bookings/methods");
const { quickApiPutHandler } = require("/opt/data-utils");
const { batchTransactData } = require("/opt/dynamodb");


describe("Bookings POST handler", () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fail unit tests", async () => {
    // Ensure failure here
    expect(false).toBe(true);
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
      acCollectionId: "ac1",
      activityType: "type1",
      activityId: "id1",
      startDate: "2024-01-01",
    };
    const event = { body: JSON.stringify(body) };

    createBooking.mockResolvedValue([{ booking: "data" }]);
    quickApiPutHandler.mockResolvedValue([{ put: "item" }]);
    batchTransactData.mockResolvedValue({ result: "ok" });

    const result = await handler(event, context);

    expect(createBooking).toHaveBeenCalledWith(
      "ac1",
      "type1",
      "id1",
      "2024-01-01",
      body
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
    const body = {};
    const event = {
      body: JSON.stringify(body),
      pathParameters: {
        acCollectionId: "ac2",
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
      body
    );
    expect(result.status).toBe(200);
    const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
    expect(data.booking).toEqual([{ booking: "data2" }]);
  });

  it("should handle errors thrown in try block", async () => {
    const body = {
      acCollectionId: "ac1",
      activityType: "type1",
      activityId: "id1",
      startDate: "2024-01-01",
    };
    const event = { body: JSON.stringify(body) };

    createBooking.mockRejectedValue(new Error("DB error"));

    const result = await handler(event, context);
    expect(result.status).toBe(400);
    expect(result.message).toBe("DB error");
  });
});