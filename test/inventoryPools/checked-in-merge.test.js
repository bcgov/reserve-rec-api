"use strict";

/**
 * inventory-pools GET attaching checkedInCount (bcgov/reserve-rec-admin#391).
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

jest.mock("../../src/handlers/bookings/methods", () => ({
  countCheckedInBookingsByDate: jest.fn(),
}));

const { handler } = require("../../src/handlers/inventoryPools/GET/admin");
const { fetchInventoryPoolsForDateRange } = require("../../src/handlers/inventoryPools/methods");
const { countCheckedInBookingsByDate } = require("../../src/handlers/bookings/methods");

const POOLS = [
  { date: "2026-09-05", capacity: 100, availability: 80 },
  { date: "2026-09-06", capacity: 100, availability: 100 },
];

function event(query = {}) {
  return {
    httpMethod: "GET",
    pathParameters: { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "1" },
    queryStringParameters: { startDate: "2026-09-01", endDate: "2026-09-30", ...query },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchInventoryPoolsForDateRange.mockResolvedValue(POOLS.map((p) => ({ ...p })));
});

describe("includeCheckedIn", () => {
  it("attaches the count to the matching date", async () => {
    countCheckedInBookingsByDate.mockResolvedValue({ "2026-09-05": 7 });

    const res = await handler(event({ includeCheckedIn: "true" }), {});

    expect(res.data[0]).toMatchObject({ date: "2026-09-05", checkedInCount: 7 });
  });

  // 0 and "not counted" must stay distinguishable: the calendar shows NA for
  // the latter, so an uncounted date must not arrive as 0.
  it("uses 0 for a date with no check-ins", async () => {
    countCheckedInBookingsByDate.mockResolvedValue({ "2026-09-05": 7 });

    const res = await handler(event({ includeCheckedIn: "true" }), {});

    expect(res.data[1]).toMatchObject({ date: "2026-09-06", checkedInCount: 0 });
  });

  it("does not count unless asked", async () => {
    const res = await handler(event(), {});

    expect(countCheckedInBookingsByDate).not.toHaveBeenCalled();
    expect(res.data[0].checkedInCount).toBeUndefined();
  });

  it("ignores includeCheckedIn=1 and other truthy-looking values", async () => {
    await handler(event({ includeCheckedIn: "1" }), {});

    expect(countCheckedInBookingsByDate).not.toHaveBeenCalled();
  });

  it("still returns capacity when the tally fails", async () => {
    countCheckedInBookingsByDate.mockRejectedValue(new Error("dynamo said no"));

    const res = await handler(event({ includeCheckedIn: "true" }), {});

    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(2);
    expect(res.data[0].checkedInCount).toBeUndefined();
  });

  it("passes the requested range through", async () => {
    countCheckedInBookingsByDate.mockResolvedValue({});

    await handler(event({ includeCheckedIn: "true" }), {});

    expect(countCheckedInBookingsByDate).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "1", startDate: "2026-09-01", endDate: "2026-09-30" })
    );
  });
});
