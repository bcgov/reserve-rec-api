"use strict";

/**
 * inventory-pools GET public endpoint
 * Tests for retrieving inventory pool data (isOpen and availability)
 */
jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  sendResponse: jest.fn((status, data, message) => ({ status, data, message })),
}));

jest.mock("../../src/handlers/inventoryPools/methods", () => ({
  fetchInventoryPoolsOnDate: jest.fn(),
  fetchInventoryPoolsForDateRange: jest.fn(),
}));

const { handler } = require("../../src/handlers/inventoryPools/GET/public");
const { fetchInventoryPoolsForDateRange, fetchInventoryPoolsOnDate } = require("../../src/handlers/inventoryPools/methods");

const POOLS = [
  {
    pk: "inventoryPool::bcparks_999::dayuse::1::1::2026-09-05",
    capacity: 100,
    availability: 80,
    isOpen: true,
  },
  {
    pk: "inventoryPool::bcparks_999::dayuse::1::1::2026-09-06",
    capacity: 100,
    availability: 100,
    isOpen: false,
  },
  {
    pk: "inventoryPool::bcparks_999::dayuse::1::1::2026-09-07",
    capacity: 50,
    availability: 0,
    isOpen: true,
  },
  {
    pk: "inventoryPool::bcparks_999::dayuse::1::1::2026-12-05",
    capacity: 100,
    availability: 50,
    isOpen: true,
  },
];

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

describe("inventory-pools GET public", () => {
  it("retrieves inventory pool data for a single date", async () => {
    fetchInventoryPoolsOnDate.mockResolvedValue([POOLS[0]]);

    const res = await handler(event({ date: "2026-09-05" }), {});

    expect(fetchInventoryPoolsOnDate).toHaveBeenCalledWith({
      bypassDiscoveryRules: false,
      collectionId: "bcparks_999",
      activityType: "dayuse",
      activityId: "9",
      productId: "9",
      date: "2026-09-05",
    });
    expect(res.data).toMatchObject({ isOpen: true, available: 80 });
  });

  it("retrieves inventory pools for a date range", async () => {
    fetchInventoryPoolsForDateRange.mockResolvedValue(POOLS);

    const res = await handler(event({ startDate: "2026-09-05", endDate: "2026-09-07" }), {});

    expect(fetchInventoryPoolsForDateRange).toHaveBeenCalledWith({
      collectionId: "bcparks_999",
      activityType: "dayuse",
      activityId: "9",
      productId: "9",
      startDate: "2026-09-05",
      endDate: "2026-09-07",
    });
    expect(res.data).toMatchObject({
      "2026-09-05": { isOpen: true, available: 80 },
      "2026-09-06": { isOpen: false, available: 100 },
      "2026-09-07": { isOpen: true, available: 0 },
    });
  });

  it("enforces maximum 1-month date range when requesting 3 months", async () => {
    //Handler only lets 1 month of dates be grabbed 
    fetchInventoryPoolsForDateRange.mockResolvedValue(POOLS);

    const res = await handler(event({ startDate: "2026-09-05", endDate: "2026-12-05" }), {});

    // Verify the handler capped the date range to 1 month from start
    expect(fetchInventoryPoolsForDateRange).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-05",
        endDate: "2026-10-05",
      })
    );
    //December pool not present. 
    expect(res.data["2026-12-05"]).toBeUndefined();
    // Sept dates should be present
    expect(res.data["2026-09-05"]).toBeDefined();
  });
});
