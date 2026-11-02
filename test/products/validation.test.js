"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const { adminEvent, parse } = require("../helpers/adminEvent");
const post = require("../../src/handlers/products/_collectionId/POST/admin").handler;
const put = require("../../src/handlers/products/_collectionId/PUT/admin").handler;

const asset = { primaryKey: { pk: "asset::bcparks_7", sk: "parking::1" }, allocationType: "flex", quantity: 20 };
const policyRef = (type) => ({ primaryKey: { pk: `policy::${type}`, sk: "1" } });

// [field, accepted value, rejected value]
const SHARED_FIELDS = [
  ["displayName", "AM pass", 5],
  ["description", "Morning entry", ["x"]],
  ["rangeStart", "2026-09-01", "09/01/2026"],
  ["rangeEnd", "2026-09-30", "end of month"],
  ["timezone", "America/Vancouver", 7],
  ["minStay", { days: 1 }, 1],
  ["maxStay", { weeks: 2 }, { nights: 2 }],
  ["assets", [{ pk: "asset::bcparks_7", sk: "1" }], [{ pk: "asset::bcparks_7" }]],
  ["assetList", [asset], [{ ...asset, quantity: "20" }]],
  ["availabilityEstimationPattern", { estimationMode: "tiered", cadence: {}, tiers: [] }, { estimationMode: "tiered", cadence: {} }],
  ["waitRoomConfig", { enabled: true }, "on"],
  ["allDatesReservedIntervals", [{ id: "a", label: "Long weekend", startDate: "2026-09-05", endDate: "2026-09-07" }], [{ id: "a", label: "no dates" }]],
  ["isReservable", true, "yes"],
  ["isChangeable", false, 0],
  ["isCancellable", true, "no"],
  ["isVisible", false, "hidden"],
  ["passesRequired", true, 1],
  ["qrCodeEnabled", true, "true"],
  ["searchTerms", ["lake"], ["lake", 3]],
  ["adminNotes", "internal", { note: 1 }],
  ["reservationPolicy", policyRef("reservation"), { name: "no key" }],
  ["partyPolicy", policyRef("party"), { name: "no key" }],
  ["feePolicy", policyRef("fee"), { name: "no key" }],
  ["changePolicy", policyRef("change"), { name: "no key" }],
];

const BAD_ASSET_LISTS = [
  ["not an array", asset],
  ["no primaryKey", [{ allocationType: "flex", quantity: 1 }]],
  ["a primaryKey with extra keys", [{ ...asset, primaryKey: { pk: "a", sk: "b", x: 1 } }]],
  ["no allocationType", [{ primaryKey: asset.primaryKey, quantity: 1 }]],
  ["an unknown allocationType", [{ ...asset, allocationType: "pool" }]],
  ["a zero quantity", [{ ...asset, quantity: 0 }]],
];

const BAD_ESTIMATION_PATTERNS = [
  ["not an object", "exact"],
  ["no estimationMode", { cadence: {} }],
  ["an unknown estimationMode", { estimationMode: "guess", cadence: {} }],
  ["no cadence", { estimationMode: "exact" }],
];

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
  db.batchWriteData.mockResolvedValue(true);
  db.runQuery.mockResolvedValue({ items: [] });
  db.incrementCounter.mockResolvedValue(3);
  db.getOne.mockResolvedValue({});
});

const putProduct = async (body) => parse(await put(adminEvent({
  httpMethod: "PUT",
  pathParameters: { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" },
  body,
})));

const postProduct = async (overrides) => parse(await post(adminEvent({
  httpMethod: "POST",
  pathParameters: { collectionId: "bcparks_7" },
  body: { activityType: "dayuse", activityId: 1, displayName: "AM", timezone: "America/Vancouver", ...overrides },
})));

describe("product update validation", () => {
  it.each(SHARED_FIELDS)("accepts a valid %s", async (field, good) => {
    const res = await putProduct({ [field]: good });

    expect(res.status).toBe(200);
    expect(db.batchTransactData.mock.calls[0][0][0].data.ExpressionAttributeNames[`#${field}`]).toBe(field);
  });

  it.each(SHARED_FIELDS)("rejects an invalid %s", async (field, _good, bad) => {
    const res = await putProduct({ [field]: bad });

    expect(res.status).toBe(400);
    expect(res.msg).toBe(`Validation failed for field '${field}'`);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it.each(BAD_ASSET_LISTS)("rejects an assetList with %s", async (_label, assetList) => {
    expect((await putProduct({ assetList })).msg).toBe("Validation failed for field 'assetList'");
  });

  it.each(BAD_ESTIMATION_PATTERNS)("rejects an availabilityEstimationPattern with %s", async (_label, pattern) => {
    expect((await putProduct({ availabilityEstimationPattern: pattern })).msg).toBe("Validation failed for field 'availabilityEstimationPattern'");
  });

  it("accepts a policy given as a bare pk/sk reference", async () => {
    expect((await putProduct({ feePolicy: { pk: "policy::fee", sk: "1" } })).status).toBe(200);
  });

  it("refuses fields that cannot be edited", async () => {
    const res = await putProduct({ globalId: "new-id" });

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Invalid field.");
  });
});

describe("product create validation", () => {
  it.each(SHARED_FIELDS)("accepts a valid %s", async (field, good) => {
    const res = await postProduct({ [field]: good });

    expect(res.status).toBe(200);
    expect(db.batchTransactData).toHaveBeenCalledTimes(1);
  });

  it.each(SHARED_FIELDS)("rejects an invalid %s", async (field, _good, bad) => {
    const res = await postProduct({ [field]: bad });

    expect(res.status).toBe(400);
    expect(res.msg).toBe(`Validation failed for field '${field}'`);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ["activityType", { activityType: "skiing" }],
    ["activityId", { activityId: "abc" }],
    ["activitySubType", { activitySubType: "jetpack" }],
  ])("rejects an invalid %s", async (field, overrides) => {
    expect((await postProduct(overrides)).msg).toBe(`Validation failed for field '${field}'`);
  });

  it("accepts a known activitySubType", async () => {
    expect((await postProduct({ activitySubType: "rv" })).status).toBe(200);
  });

  it("refuses a field the product schema does not have", async () => {
    expect((await postProduct({ colour: "green" })).msg).toBe("Invalid field.");
  });
});
