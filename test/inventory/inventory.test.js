"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { adminEvent, parse } = require("../helpers/adminEvent");
const { initializeInventory } = require("../../src/handlers/inventory/methods");
const getAdmin = require("../../src/handlers/inventory/GET/admin").handler;
const post = require("../../src/handlers/inventory/POST/admin").handler;
const del = require("../../src/handlers/inventory/DELETE/admin").handler;

const PATH = { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" };
const invPk = (date) => `inventory::bcparks_7::dayuse::1::2::${date}`;
const asset = { primaryKey: { pk: "asset::bcparks_7", sk: "site::1" }, allocationType: "fixed", quantity: 2 };
const event = (overrides = {}) => adminEvent({ pathParameters: PATH, permissions: { bcparks_7: "staff" }, ...overrides });

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
  db.runQuery.mockResolvedValue({ items: [] });
});

afterEach(() => jest.useRealTimers());

describe("initializeInventory", () => {
  it("creates one available unit per quantity of each asset", async () => {
    db.runQuery.mockResolvedValue({ items: [{ pk: "productDate::x", sk: "2026-09-05", date: "2026-09-05", version: 2, assetList: [asset] }] });

    const [units, successes, failures] = await initializeInventory("bcparks_7", "dayuse", "1", "2", "2026-09-05", "2026-09-05");

    expect(units.map((u) => u.sk)).toEqual(["asset::bcparks_7::site::1::1", "asset::bcparks_7::site::1::2"]);
    expect(units[1]).toEqual({
      pk: invPk("2026-09-05"), sk: "asset::bcparks_7::site::1::2", schema: "inventory", inventoryId: 2, date: "2026-09-05",
      allocationType: "fixed", assetRef: asset, productDateRef: { pk: "productDate::x", sk: "2026-09-05" },
      productDateVersion: 2, allocationStatus: "available",
    });
    expect(successes).toHaveLength(2);
    expect(failures).toEqual([]);
    expect(db.runQuery.mock.calls[0][0].FilterExpression).toBeUndefined();
  });

  it("reports dates without assets and assets it cannot key", async () => {
    db.runQuery.mockResolvedValue({ items: [{ date: "2026-09-05" }, { date: "2026-09-06", assetList: [{ quantity: 1 }] }] });

    const [units, , failures] = await initializeInventory("bcparks_7", "dayuse", "1", "2", "2026-09-05", "2026-09-06");

    expect(units).toEqual([]);
    expect(failures.map((f) => f.date)).toEqual(["2026-09-05", "2026-09-06"]);
    expect(failures[1].reason).toMatch(/^Error creating inventory record/);
  });
});

describe("GET inventory", () => {
  it("reads one date filtered by asset prefix and allocation status", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "u1" }] });

    const res = parse(await getAdmin(event({ queryStringParameters: { date: "2026-09-05", facilityType: "site", facilityId: "1", allocationStatus: "held", limit: "3" } })));

    expect(res.data).toEqual([{ sk: "u1" }]);
    const [q, limit] = db.runQuery.mock.calls[0];
    expect(q.KeyConditionExpression).toBe("pk = :pk AND begins_with(sk, :skPrefix)");
    expect(q.ExpressionAttributeValues).toEqual({
      ":pk": { S: invPk("2026-09-05") }, ":skPrefix": { S: "asset::bcparks_7::site::1" }, ":allocationStatus": { S: "held" },
    });
    expect(q.FilterExpression).toBe("allocationStatus = :allocationStatus");
    expect(limit).toBe(3);
  });

  it("400s without a date", async () => {
    expect(parse(await getAdmin(event())).status).toBe(400);
    expect(db.runQuery).not.toHaveBeenCalled();
  });

  it("passes a database failure back as an error", async () => {
    db.runQuery.mockRejectedValue(new Error("down"));

    expect(parse(await getAdmin(event({ queryStringParameters: { date: "2026-09-05" } }))).msg).toBe("down");
  });
});

describe("POST inventory", () => {
  const postEvent = (q = { startDate: "2026-09-05" }, permissions) =>
    adminEvent({ httpMethod: "POST", pathParameters: PATH, queryStringParameters: q, permissions: permissions ?? { bcparks_7: "staff" } });

  it("writes every unit for the ProductDates in range", async () => {
    db.runQuery.mockResolvedValue({ items: [{ pk: "p", sk: "s", date: "2026-09-05", assetList: [asset] }] });

    const res = parse(await post(postEvent()));

    expect(res.status).toBe(200);
    expect(res.msg).toBe("Successfully initialized 2 inventory records for product 2 from 2026-09-05 to 2026-09-05");
    const items = db.batchTransactData.mock.calls[0][0].map((op) => unmarshall(op.data.Item));
    expect(items.map((i) => i.inventoryId)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ allocationStatus: "available", version: 1 });
  });

  it("stops with 207 when a date has no assets", async () => {
    db.runQuery.mockResolvedValue({ items: [{ date: "2026-09-05" }] });

    const res = parse(await post(postEvent()));

    expect(res.status).toBe(207);
    expect(res.data).toMatchObject({ successes: 0, failures: 1 });
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("retries a failed write before reporting it", async () => {
    jest.useFakeTimers();
    db.runQuery.mockResolvedValue({ items: [{ pk: "p", sk: "s", date: "2026-09-05", assetList: [asset] }] });
    db.batchTransactData.mockRejectedValue(new Error("throttled"));

    const pending = post(postEvent({ startDate: "2026-09-05", skipWarnings: "true" }));
    await jest.advanceTimersByTimeAsync(600);
    const res = parse(await pending);

    expect(res.msg).toBe("Failed to write inventory records to DynamoDB after multiple attempts");
    expect(db.batchTransactData).toHaveBeenCalledTimes(4);
  });

  it("refuses staff of another collection and limited users", async () => {
    expect(parse(await post(postEvent(undefined, { other_1: "staff" }))).status).toBe(403);
    expect(parse(await post(postEvent(undefined, { bcparks_7: "limited" }))).status).toBe(403);
    expect(db.runQuery).not.toHaveBeenCalled();
  });

  it("400s without a start date or full path", async () => {
    expect(parse(await post(postEvent({}))).msg).toBe("Missing required query parameter: startDate");
    expect(parse(await post(adminEvent({ httpMethod: "POST", pathParameters: {} }))).status).toBe(400);
  });
});

describe("DELETE inventory", () => {
  it("deletes every unit found in the range", async () => {
    db.runQuery
      .mockResolvedValueOnce({ items: [{ pk: invPk("2026-09-05"), sk: "u1" }] })
      .mockResolvedValueOnce({ items: [{ pk: invPk("2026-09-06"), sk: "u1" }] });

    const res = parse(await del(event({ httpMethod: "DELETE", body: { startDate: "2026-09-05", endDate: "2026-09-06" } })));

    expect(res.msg).toBe("Inventory deleted successfully. Total deleted: 2");
    const [deletes, action] = db.batchTransactData.mock.calls[0];
    expect(action).toBe("Delete");
    expect(deletes.map((d) => d.Key.pk.S)).toEqual([invPk("2026-09-05"), invPk("2026-09-06")]);
  });

  // The handler has no checkAuthContext, so any caller can delete.
  test.failing("403s a caller without staff on the collection and deletes nothing", async () => {
    const res = parse(await del(event({ httpMethod: "DELETE", permissions: { bcparks_9: "staff" }, queryStringParameters: { startDate: "2026-09-05" } })));
    expect(res.status).toBe(403);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("400s without the full path and on a write failure", async () => {
    expect(parse(await del(event({ httpMethod: "DELETE", pathParameters: {} }))).status).toBe(400);
    db.batchTransactData.mockRejectedValue(new Error("denied"));
    expect(parse(await del(event({ httpMethod: "DELETE", queryStringParameters: { startDate: "2026-09-05" } }))).msg).toBe("denied");
  });
});
