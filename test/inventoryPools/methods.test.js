"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const {
  fetchInventoryPoolsOnDate,
  fetchInventoryPoolsForDateRange,
  initializeInventoryPools,
  deleteInventoryPools,
} = require("../../src/handlers/inventoryPools/methods");

const KEYS = { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" };
const poolPk = (date) => `inventoryPool::bcparks_7::dayuse::1::2::${date}`;
const asset = { primaryKey: { pk: "asset::bcparks_7", sk: "parking::1" }, allocationType: "flex", quantity: 20 };

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
});

describe("fetchInventoryPoolsOnDate", () => {
  it("reads the date's pool partition", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "a" }] });

    expect(await fetchInventoryPoolsOnDate({ ...KEYS, date: "2026-09-05", limit: 10 })).toEqual([{ sk: "a" }]);
    const [q, limit] = db.runQuery.mock.calls[0];
    expect(q).toEqual({ TableName: db.REFERENCE_DATA_TABLE_NAME, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": { S: poolPk("2026-09-05") } } });
    expect(limit).toBe(10);
  });

  it("narrows by asset prefix up to the first missing level", async () => {
    db.runQuery.mockResolvedValue({ items: [] });

    await fetchInventoryPoolsOnDate({ ...KEYS, date: "2026-09-05", facilityType: "parking", facilityId: "1", assetId: "9" });

    const q = db.runQuery.mock.calls[0][0];
    expect(q.KeyConditionExpression).toBe("pk = :pk AND begins_with(sk, :skPrefix)");
    expect(q.ExpressionAttributeValues[":skPrefix"]).toEqual({ S: "asset::bcparks_7::parking::1" });
  });

  it("adds a projection when fields are given", async () => {
    db.runQuery.mockResolvedValue({ items: [] });

    await fetchInventoryPoolsOnDate({ ...KEYS, date: "2026-09-05", projectionFields: ["pk", "availability"] });

    expect(db.runQuery.mock.calls[0][0]).toMatchObject({ ProjectionExpression: "#pk, #availability", ExpressionAttributeNames: { "#pk": "pk", "#availability": "availability" } });
  });

  it("returns nothing when discovery rules hide the date", async () => {
    db.runQuery.mockResolvedValueOnce({ items: [] });

    expect(await fetchInventoryPoolsOnDate({ ...KEYS, date: "2026-09-05", bypassDiscoveryRules: false })).toEqual([]);
    expect(db.runQuery).toHaveBeenCalledTimes(1);
    expect(db.runQuery.mock.calls[0][0].ExpressionAttributeValues[":pk"]).toEqual({ S: "productDate::bcparks_7::dayuse::1::2" });
  });

  it("reads pools once the date is discoverable", async () => {
    db.runQuery.mockResolvedValueOnce({ items: [{ date: "2026-09-05" }] }).mockResolvedValueOnce({ items: [{ sk: "a" }] });

    expect(await fetchInventoryPoolsOnDate({ ...KEYS, date: "2026-09-05", bypassDiscoveryRules: false })).toEqual([{ sk: "a" }]);
  });

  it("requires the product keys", async () => {
    await expect(fetchInventoryPoolsOnDate({ collectionId: "c", date: "2026-09-05" })).rejects.toThrow("Missing required parameters");
  });
});

describe("fetchInventoryPoolsForDateRange", () => {
  it("reads every day in the range and skips a day that fails", async () => {
    db.runQuery
      .mockResolvedValueOnce({ items: [{ date: "2026-09-05" }] })
      .mockRejectedValueOnce(new Error("throttled"))
      .mockResolvedValueOnce({ items: [{ date: "2026-09-07" }] });

    const pools = await fetchInventoryPoolsForDateRange({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-07" });

    expect(pools).toEqual([{ date: "2026-09-05" }, { date: "2026-09-07" }]);
    expect(db.runQuery.mock.calls.map((c) => c[0].ExpressionAttributeValues[":pk"].S)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"].map(poolPk));
  });

  it("only reads the dates discovery rules let through", async () => {
    db.runQuery
      .mockResolvedValueOnce({ items: [{ date: "2026-09-06" }] })
      .mockResolvedValueOnce({ items: [{ date: "2026-09-06" }] })
      .mockResolvedValueOnce({ items: [{ pk: poolPk("2026-09-06") }] });

    const pools = await fetchInventoryPoolsForDateRange({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-07", bypassDiscoveryRules: false });

    expect(pools).toEqual([{ pk: poolPk("2026-09-06") }]);
    expect(db.runQuery).toHaveBeenCalledTimes(3);
  });

  it("returns nothing when no date is discoverable", async () => {
    db.runQuery.mockResolvedValue({ items: [] });

    expect(await fetchInventoryPoolsForDateRange({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-07", bypassDiscoveryRules: false })).toEqual([]);
    expect(db.runQuery).toHaveBeenCalledTimes(1);
  });

  it("requires both dates", async () => {
    await expect(fetchInventoryPoolsForDateRange({ ...KEYS, startDate: "2026-09-05" })).rejects.toThrow("Missing required parameters");
  });
});

describe("initializeInventoryPools", () => {
  it("prepares one full pool per asset per ProductDate and reports dates without assets", async () => {
    db.runQuery.mockResolvedValue({ items: [
      { pk: "productDate::x", sk: "2026-09-05", date: "2026-09-05", version: 3, assetList: [asset] },
      { pk: "productDate::x", sk: "2026-09-06", date: "2026-09-06", assetList: [] },
    ] });

    const [pools, successes, failures] = await initializeInventoryPools({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-06" });

    expect(pools).toEqual([{
      pk: poolPk("2026-09-05"),
      sk: "asset::bcparks_7::parking::1",
      schema: "inventoryPool",
      date: "2026-09-05",
      assetRef: asset,
      allocationType: "flex",
      productDateRef: { pk: "productDate::x", sk: "2026-09-05" },
      productDateVersion: 3,
      capacity: 20,
      availability: 20,
      availabilityEstimationPattern: null,
    }]);
    expect(successes).toHaveLength(1);
    expect(failures).toEqual([expect.objectContaining({ date: "2026-09-06", reason: "No assets found for this product date" })]);
  });

  it("records an asset without a primaryKey as a failure", async () => {
    db.runQuery.mockResolvedValue({ items: [{ date: "2026-09-05", assetList: [{ quantity: 1 }] }] });

    const [pools, , failures] = await initializeInventoryPools({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-05" });

    expect(pools).toEqual([]);
    expect(failures[0].reason).toContain("Error initializing InventoryPools for this product date 2026-09-05");
  });

  it("passes a ProductDates read failure through", async () => {
    db.runQuery.mockRejectedValue(new Error("down"));

    await expect(initializeInventoryPools({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-05" })).rejects.toThrow("down");
  });
});

describe("deleteInventoryPools", () => {
  it("finds every pool in the range and deletes it by key", async () => {
    db.runQuery
      .mockResolvedValueOnce({ items: [{ pk: poolPk("2026-09-05"), sk: "a" }, { pk: poolPk("2026-09-05"), sk: "b" }] })
      .mockResolvedValueOnce({ items: [{ pk: poolPk("2026-09-06"), sk: "a" }] });

    expect(await deleteInventoryPools({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-06" })).toBe(3);

    const [deletes, action] = db.batchTransactData.mock.calls[0];
    expect(action).toBe("Delete");
    expect(deletes[2]).toEqual({ TableName: db.REFERENCE_DATA_TABLE_NAME, Key: { pk: { S: poolPk("2026-09-06") }, sk: { S: "a" } } });
  });

  it("passes a write failure through", async () => {
    db.runQuery.mockResolvedValue({ items: [] });
    db.batchTransactData.mockRejectedValue(new Error("denied"));

    await expect(deleteInventoryPools({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-05" })).rejects.toThrow("denied");
  });
});
