"use strict";

/**
 * product-dates GET public endpoint
 */
jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({ authenticated: true })),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  sendResponse: jest.fn((status, data, message) => ({ status, data, message })),
}));

jest.mock("../../src/handlers/productDates/methods", () => ({
  fetchProductDates: jest.fn(),
  fetchProductDateByDate: jest.fn(),
}));

const { handler } = require("../../src/handlers/productDates/_productId/GET/public");
const { requestIdentity } = require("/opt/base");
const { fetchProductDates, fetchProductDateByDate } = require("../../src/handlers/productDates/methods");

function event(query = {}) {
  return {
    httpMethod: "GET",
    pathParameters: { collectionId: "bcparks_999", activityType: "dayuse", activityId: "9", productId: "9" },
    queryStringParameters: query,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("product-dates GET public", () => {
  it("refuses a signed-out caller", async () => {
    requestIdentity.mockReturnValueOnce({ authenticated: false });

    const res = await handler(event({ startDate: "2026-09-05", endDate: "2026-09-07" }), {});

    expect(res.status).toBe(401);
    expect(fetchProductDates).not.toHaveBeenCalled();
    expect(fetchProductDateByDate).not.toHaveBeenCalled();
  });

  it("returns product dates to a signed-in caller", async () => {
    fetchProductDates.mockResolvedValue([{ date: "2026-09-05" }]);

    const res = await handler(event({ startDate: "2026-09-05", endDate: "2026-09-07" }), {});

    expect(res.status).toBe(200);
    expect(fetchProductDates).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-09-05", endDate: "2026-09-07", bypassDiscoveryRules: false })
    );
  });
});
