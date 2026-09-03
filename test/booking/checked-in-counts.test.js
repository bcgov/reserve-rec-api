"use strict";

/**
 * Checked-in tallies for the capacity calendar (bcgov/reserve-rec-admin#391).
 * Mock set mirrors test/booking/duplicate-check.test.js, which also loads
 * bookings/methods directly.
 */
jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock("@aws-sdk/util-dynamodb", () => ({ unmarshall: jest.fn((x) => x) }));

jest.mock("/opt/dynamodb", () => ({
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  getOneByGlobalId: jest.fn(),
  REFERENCE_DATA_TABLE_NAME: "RefTable",
  TRANSACTIONAL_DATA_TABLE_NAME: "TxTable",
  SPARSE_GSI1_NAME: "sparse-gsi-1",
  USERID_INDEX_NAME: "userId-index",
  USERID_PROPERTY_NAME: "userId",
}));

jest.mock("/opt/sns", () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock("../../lib/handlers/emailDispatch/utils", () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));
jest.mock("../../src/handlers/activities/methods", () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock("../../src/common/data-utils", () => ({
  getAndAttachNestedProperties: jest.fn(),
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));
jest.mock("../../src/handlers/productDates/methods", () => ({ fetchProductDates: jest.fn() }));
jest.mock("../../src/handlers/productDates/configs", () => ({ PUBLIC_PRODUCTDATE_PROJECTIONS: {} }));
jest.mock("../../src/handlers/users/methods", () => ({ getUserInfoByUserName: jest.fn() }));
jest.mock("../../src/handlers/bookings/configs", () => ({
  BOOKING_PUT_CONFIG: {},
  BOOKINGDATES_PUT_CONFIG: {},
  BOOKING_UPDATE_CONFIG: {},
}));

const { runQuery } = require("/opt/dynamodb");
const { countCheckedInBookingsByDate } = require("../../src/handlers/bookings/methods");

const TARGET = {
  collectionId: "bcparks_7",
  activityType: "dayuse",
  activityId: "1",
  productId: "1",
  startDate: "2026-09-01",
  endDate: "2026-09-30",
};

beforeEach(() => runQuery.mockReset());

describe("countCheckedInBookingsByDate", () => {
  it("counts only bookings carrying checkedInTime", async () => {
    runQuery.mockResolvedValueOnce({
      items: [
        { startDate: "2026-09-05", checkedInTime: 1757000000000 },
        { startDate: "2026-09-05", checkedInTime: 1757000000001 },
        { startDate: "2026-09-05" }, // reserved, never scanned in
        { startDate: "2026-09-06", checkedInTime: 1757100000000 },
      ],
    });

    expect(await countCheckedInBookingsByDate(TARGET)).toEqual({
      "2026-09-05": 2,
      "2026-09-06": 1,
    });
  });

  it("leaves dates with no check-ins out of the tally", async () => {
    runQuery.mockResolvedValueOnce({ items: [{ startDate: "2026-09-05" }] });

    expect(await countCheckedInBookingsByDate(TARGET)).toEqual({});
  });

  // Bookings live under the product-scoped pk; the 4-segment one matches nothing.
  it("queries the product-scoped partition over the date range", async () => {
    runQuery.mockResolvedValueOnce({ items: [] });

    await countCheckedInBookingsByDate(TARGET);
    const query = runQuery.mock.calls[0][0];

    expect(query.ExpressionAttributeValues[":pk"]).toBe("booking::bcparks_7::dayuse::1::1");
    expect(query.KeyConditionExpression).toContain("sk BETWEEN");
    expect(query.ExpressionAttributeValues[":from"]).toBe("2026-09-01::");
    expect(query.ExpressionAttributeValues[":to"]).toBe("2026-09-30::￿");
    expect(query.ProjectionExpression).toBe("startDate, checkedInTime");
  });

  it("follows pagination so a busy month is not undercounted", async () => {
    runQuery
      .mockResolvedValueOnce({
        items: [{ startDate: "2026-09-05", checkedInTime: 1 }],
        LastEvaluatedKey: { pk: "x", sk: "y" },
      })
      .mockResolvedValueOnce({ items: [{ startDate: "2026-09-05", checkedInTime: 2 }] });

    expect(await countCheckedInBookingsByDate(TARGET)).toEqual({ "2026-09-05": 2 });
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls[1][0].ExclusiveStartKey).toEqual({ pk: "x", sk: "y" });
  });

  it("handles a raw array response", async () => {
    runQuery.mockResolvedValueOnce([{ startDate: "2026-09-07", checkedInTime: 1 }]);

    expect(await countCheckedInBookingsByDate(TARGET)).toEqual({ "2026-09-07": 1 });
  });
});
