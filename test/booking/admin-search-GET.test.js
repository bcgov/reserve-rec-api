"use strict";

// GET /bookings/admin through the real methods.js helpers; DynamoDB and activity lookups are faked.
jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  handleCORS: jest.fn((event) => (event.httpMethod === "OPTIONS" ? { status: 200 } : null)),
  checkAuthContext: jest.fn(() => ({ sub: "admin-sub" })),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.msg = message;
    this.code = data?.code;
    this.data = data?.data;
  }),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sendResponse: jest.fn((status, data, message) => ({ status, data, message })),
}));

jest.mock("/opt/dynamodb", () => ({
  TRANSACTIONAL_DATA_TABLE_NAME: "trans",
  REFERENCE_DATA_TABLE_NAME: "ref",
  SPARSE_GSI1_NAME: "gsi1",
  USERID_INDEX_NAME: "userIdx",
  USERID_PROPERTY_NAME: "userId",
  getOneByGlobalId: jest.fn(),
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  batchTransactData: jest.fn(),
}));
jest.mock("/opt/sns", () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock("../../lib/handlers/emailDispatch/utils", () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));
jest.mock("../../src/handlers/users/methods", () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
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

const { getOneByGlobalId, runQuery } = require("/opt/dynamodb");
const { getActivitiesByCollectionId } = require("../../src/handlers/activities/methods");
const { handler } = require("../../src/handlers/bookings/GET/admin");

const ACTIVITIES = {
  bcparks_2: [{ collectionId: "bcparks_2", activityType: "dayuse", activityId: 1 }],
  bcparks_10: [
    { collectionId: "bcparks_10", activityType: "dayuse", activityId: 2 },
    { collectionId: "bcparks_10", activityType: "backcountry", activityId: 3 },
  ],
};

function booking(globalId, collectionId, activityType, activityId, startDate, bookedAt) {
  return { globalId, collectionId, activityType, activityId, startDate, endDate: startDate, bookedAt };
}

const BOOKINGS = {
  "bcparks_2::dayuse::1": [
    booking("b2-a", "bcparks_2", "dayuse", 1, "2026-06-05", "2026-05-01T10:00:00Z"),
    booking("b2-b", "bcparks_2", "dayuse", 1, "2026-06-03", "2026-05-01T10:00:00Z"),
  ],
  "bcparks_10::dayuse::2": [
    booking("b10-a", "bcparks_10", "dayuse", 2, "2026-06-04", "2026-05-01T10:00:00Z"),
  ],
  "bcparks_10::backcountry::3": [
    booking("b10-b", "bcparks_10", "backcountry", 3, "2026-06-01", "2026-05-01T10:00:00Z"),
    booking("b10-c", "bcparks_10", "backcountry", 3, "2026-06-04", "2026-05-01T11:00:00Z"),
  ],
};

const ids = (res) => res.data.items.map((b) => b.globalId);

function search(params) {
  return handler({ httpMethod: "GET", queryStringParameters: params }, {});
}

describe("GET /bookings/admin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date("2026-06-10T12:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
    getActivitiesByCollectionId.mockImplementation(async (collectionId, filters) => ({
      items: (ACTIVITIES[collectionId] || [])
        .filter((a) => !filters.activityType || a.activityType === filters.activityType)
        .map((a) => ({ ...a })),
    }));
    runQuery.mockImplementation(async (query) => {
      const key = query.ExpressionAttributeValues[":pk"].replace(/^booking::/, "");
      return { items: (BOOKINGS[key] || []).map((b) => ({ ...b })) };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const range = { startDate: "2026-06-01", endDate: "2026-06-30" };

  it("returns the one booking when only a bookingId is given", async () => {
    getOneByGlobalId.mockResolvedValue({ bookingId: "bk-1", status: "confirmed" });

    const res = await search({ bookingId: "bk-1" });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ items: [{ bookingId: "bk-1", status: "confirmed" }] });
  });

  it("refuses with not_found when the single booking does not exist", async () => {
    getOneByGlobalId.mockResolvedValue(undefined);

    const res = await search({ bookingId: "missing" });

    expect(res.status).toBe(400);
    expect(res.data).toEqual({ refusal: "not_found" });
  });

  it.each([
    ["no bookingId and no filters", {}, /requires either a bookingId/],
    ["an unknown sortBy", { collectionId: "bcparks_2", sortBy: "price" }, /Invalid sortBy/],
    ["filters without a collectionId", { activityType: "dayuse" }, /collectionId is required/],
    ["a startDate more than 30 days back", { collectionId: "bcparks_2", startDate: "2026-05-01" }, /more than 30 days/],
    ["a range longer than 90 days", { collectionId: "bcparks_2", startDate: "2026-06-01", endDate: "2026-09-15" }, /cannot exceed 90 days/],
  ])("rejects %s with 400", async (_label, params, message) => {
    const res = await search(params);

    expect(res.status).toBe(400);
    expect(res.message).toMatch(message);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when lastEvaluatedKey is not JSON", async () => {
    const res = await search({ collectionId: "bcparks_2", lastEvaluatedKey: "{not json" });

    expect(res.status).toBe(400);
  });

  it("merges collections by startDate, breaking ties on bookedAt, and pages with a cursor", async () => {
    const first = await search({ collectionId: "bcparks_2, bcparks_10", ...range, limit: "3" });

    expect(first.status).toBe(200);
    expect(ids(first)).toEqual(["b10-b", "b2-b", "b10-a"]);
    expect(first.data.hasMore).toBe(true);
    expect(first.data.lastEvaluatedKey).toMatchObject({
      sortBy: "startDate",
      lastItemDate: "2026-06-04",
      lastItemBookedAt: "2026-05-01T10:00:00Z",
    });

    const second = await search({
      collectionId: "bcparks_2,bcparks_10",
      ...range,
      limit: "3",
      lastEvaluatedKey: JSON.stringify(first.data.lastEvaluatedKey),
    });

    expect(ids(second)).toEqual(["b10-c", "b2-a"]);
    expect(second.data.hasMore).toBe(false);
  });

  it("sorts newest first and resumes below the cursor when sortOrder=desc", async () => {
    const first = await search({ collectionId: "bcparks_2,bcparks_10", ...range, limit: "2", sortOrder: "desc" });

    expect(ids(first)).toEqual(["b2-a", "b10-c"]);

    const second = await search({
      collectionId: "bcparks_2,bcparks_10",
      ...range,
      limit: "2",
      sortOrder: "desc",
      lastEvaluatedKey: JSON.stringify(first.data.lastEvaluatedKey),
    });

    expect(ids(second)).toEqual(["b10-a", "b2-b"]);
    expect(second.data.hasMore).toBe(true);
  });

  it("passes the activityType filter to the activity lookup", async () => {
    const res = await search({ collectionId: "bcparks_10", activityType: "backcountry", ...range });

    expect(ids(res)).toEqual(["b10-b", "b10-c"]);
    expect(getActivitiesByCollectionId).toHaveBeenCalledWith(
      "bcparks_10",
      { activityType: "backcountry" },
      { paginated: false }
    );
  });

  it("groups by collection in numeric order and walks pages across collections", async () => {
    const params = { collectionId: "bcparks_10,bcparks_2", ...range, limit: "2", sortBy: "collectionId" };

    const page1 = await search(params);
    expect(ids(page1)).toEqual(["b2-b", "b2-a"]);
    expect(page1.data.lastEvaluatedKey).toMatchObject({ collectionIndex: 0, lastBookingId: "b2-a" });

    const page2 = await search({ ...params, lastEvaluatedKey: JSON.stringify(page1.data.lastEvaluatedKey) });
    expect(ids(page2)).toEqual(["b10-b", "b10-a"]);
    expect(page2.data.lastEvaluatedKey).toMatchObject({ collectionIndex: 1, lastBookingId: "b10-a" });

    const page3 = await search({ ...params, lastEvaluatedKey: JSON.stringify(page2.data.lastEvaluatedKey) });
    expect(ids(page3)).toEqual(["b10-c"]);
    expect(page3.data.hasMore).toBe(false);
  });

  it("hands over to the next collection when one runs short of the limit", async () => {
    const res = await search({ collectionId: "bcparks_2,bcparks_10", ...range, limit: "5", sortBy: "collectionId" });

    expect(ids(res)).toEqual(["b2-b", "b2-a"]);
    expect(res.data.lastEvaluatedKey).toMatchObject({ collectionIndex: 1, collectionId: "bcparks_10" });
  });

  it("puts the higher-numbered collection first when sortOrder=desc", async () => {
    const res = await search({
      collectionId: "bcparks_2,bcparks_10", ...range, limit: "3", sortBy: "collectionId", sortOrder: "desc",
    });

    expect(ids(res)).toEqual(["b10-b", "b10-a", "b10-c"]);
  });

  it.each([
    ["activityId", "asc", ["b10-a", "b10-b", "b10-c"]],
    ["activityId", "desc", ["b10-b", "b10-c", "b10-a"]],
    ["activityType", "asc", ["b10-b", "b10-c", "b10-a"]],
    ["activityType", "desc", ["b10-a", "b10-b", "b10-c"]],
  ])("orders by %s %s, then by date", async (sortBy, sortOrder, expected) => {
    const res = await search({ collectionId: "bcparks_10", ...range, limit: "10", sortBy, sortOrder });

    expect(ids(res)).toEqual(expected);
    expect(res.data.hasMore).toBe(false);
  });

  it.each([
    ["activityType", "asc", ["b10-b", "b10-c"], { activityIndex: 1, activityType: "dayuse" }],
    ["activityId", "desc", ["b10-b", "b10-c"], { activityIndex: 1, activityId: 2 }],
  ])("fills a %s %s page from the first activity and points at the next", async (sortBy, sortOrder, expected, cursor) => {
    const res = await search({ collectionId: "bcparks_10", ...range, limit: "2", sortBy, sortOrder });

    expect(ids(res)).toEqual(expected);
    expect(res.data.lastEvaluatedKey).toMatchObject({ sortBy, collectionIndex: 0, ...cursor });
  });

  it("points at the next collection when the last activity of one fills the page", async () => {
    const res = await search({ collectionId: "bcparks_2,bcparks_10", ...range, limit: "2", sortBy: "activityId" });

    expect(ids(res)).toEqual(["b2-b", "b2-a"]);
    expect(res.data.lastEvaluatedKey).toMatchObject({ collectionIndex: 1, activityIndex: 0, collectionId: "bcparks_10" });
  });

  it("stops at the limit once enough activity bookings are collected", async () => {
    const res = await search({ collectionId: "bcparks_10", ...range, limit: "1", sortBy: "activityId" });

    expect(ids(res)).toEqual(["b10-a"]);
    expect(res.data.lastEvaluatedKey).toMatchObject({ sortBy: "activityId", activityIndex: 1, activityId: 3 });
  });
});
