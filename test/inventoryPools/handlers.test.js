"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());
jest.mock("../../src/handlers/bookings/methods", () => ({ countCheckedInBookingsByDate: jest.fn() }));

const db = require("/opt/dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { adminEvent, parse } = require("../helpers/adminEvent");
const getAdmin = require("../../src/handlers/inventoryPools/GET/admin").handler;
const getPublic = require("../../src/handlers/inventoryPools/GET/public").handler;
const post = require("../../src/handlers/inventoryPools/POST/admin").handler;
const del = require("../../src/handlers/inventoryPools/DELETE/admin").handler;
const put = require("../../src/handlers/inventoryPools/PUT/admin").handler;
const putDate = require("../../src/handlers/inventoryPools/_collectionId/_activityType/_activityId/_productId/_date/PUT/admin").handler;

const PATH = { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" };
const poolPk = (date) => `inventoryPool::bcparks_7::dayuse::1::2::${date}`;
const asset = { primaryKey: { pk: "asset::bcparks_7", sk: "parking::1" }, allocationType: "flex", quantity: 20 };
const event = (overrides = {}) => ({ httpMethod: "GET", pathParameters: PATH, queryStringParameters: null, body: null, ...overrides });

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
  db.runQuery.mockResolvedValue({ items: [] });
});

afterEach(() => jest.useRealTimers());

describe("preflights", () => {
  it.each([["GET admin", getAdmin], ["GET public", getPublic], ["POST", post], ["DELETE", del], ["PUT", put]])("%s answers OPTIONS without touching the table", async (_name, handler) => {
    const res = await handler(event({ httpMethod: "OPTIONS" }));

    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(db.runQuery).not.toHaveBeenCalled();
  });
});

describe("GET inventory pools", () => {
  it("admin reads one date with its asset filter", async () => {
    db.runQuery.mockResolvedValue({ items: [{ date: "2026-09-05", capacity: 20 }] });

    const res = parse(await getAdmin(event({ queryStringParameters: { date: "2026-09-05", facilityType: "parking", limit: "5" } })));

    expect(res.data).toEqual([{ date: "2026-09-05", capacity: 20 }]);
    const [q, limit] = db.runQuery.mock.calls[0];
    expect(q.ExpressionAttributeValues).toMatchObject({ ":pk": { S: poolPk("2026-09-05") }, ":skPrefix": { S: "asset::bcparks_7::parking" } });
    expect(limit).toBe(5);
  });

  it("admin 400s without a date or range, or without the full path", async () => {
    expect(parse(await getAdmin(event())).msg).toBe("Must provide either 'date' for a single date or 'startDate' and 'endDate' for a date range");
    expect(parse(await getAdmin(event({ pathParameters: {} }))).status).toBe(400);
  });

  it("public 400s on an incomplete path or missing dates", async () => {
    const signedIn = { requestContext: { authorizer: { isAuthenticated: "true" } } };

    expect(parse(await getPublic(event({ ...signedIn, pathParameters: {} }))).status).toBe(400);
    expect(parse(await getPublic(event({ ...signedIn, queryStringParameters: { startDate: "2026-09-05" } }))).status).toBe(400);
  });
});

describe("POST inventory pools", () => {
  const postEvent = (q = { startDate: "2026-09-05" }, body = null) => event({ httpMethod: "POST", queryStringParameters: q, body: body && JSON.stringify(body) });

  it("creates one pool per asset for the ProductDates in range", async () => {
    db.runQuery.mockResolvedValue({ items: [{ pk: "productDate::x", sk: "2026-09-05", date: "2026-09-05", assetList: [asset] }] });

    const res = parse(await post(postEvent()));

    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(1);
    expect(db.runQuery.mock.calls[0][0].ExpressionAttributeValues).toMatchObject({ ":startDate": { S: "2026-09-05" }, ":endDate": { S: "2026-09-05" } });
    const op = db.batchTransactData.mock.calls[0][0][0];
    expect(op.data.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    expect(unmarshall(op.data.Item)).toMatchObject({ pk: poolPk("2026-09-05"), sk: "asset::bcparks_7::parking::1", capacity: 20, availability: 20, version: 1 });
  });

  it("stops with 207 and writes nothing when some dates have no assets", async () => {
    db.runQuery.mockResolvedValue({ items: [{ date: "2026-09-05", assetList: [asset] }, { date: "2026-09-06", assetList: [] }] });

    const res = parse(await post(postEvent({ startDate: "2026-09-05", endDate: "2026-09-06" })));

    expect(res.status).toBe(207);
    expect(res.data).toMatchObject({ successes: 1, failures: 1 });
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("writes the good dates anyway with skipWarnings in the body", async () => {
    db.runQuery.mockResolvedValue({ items: [{ pk: "p", sk: "s", date: "2026-09-05", assetList: [asset] }, { date: "2026-09-06" }] });

    const res = parse(await post(postEvent(null, { startDate: "2026-09-05", endDate: "2026-09-06", skipWarnings: true })));

    expect(res.status).toBe(200);
    expect(db.batchTransactData.mock.calls[0][0]).toHaveLength(1);
  });

  it("retries a failed write, then reports failure after four attempts", async () => {
    jest.useFakeTimers();
    db.runQuery.mockResolvedValue({ items: [{ pk: "p", sk: "s", date: "2026-09-05", assetList: [asset] }] });
    db.batchTransactData.mockRejectedValue(new Error("throttled"));

    const pending = post(postEvent());
    await jest.advanceTimersByTimeAsync(600);
    const res = parse(await pending);

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Failed to write InventoryPool records to DynamoDB after multiple attempts");
    expect(db.batchTransactData).toHaveBeenCalledTimes(4);
  });

  it("400s without a start date or full path", async () => {
    expect(parse(await post(postEvent({}))).msg).toBe("Missing required query parameter: startDate");
    expect(parse(await post(event({ httpMethod: "POST", pathParameters: {} }))).status).toBe(400);
  });
});

describe("DELETE inventory pools", () => {
  it("deletes the pools found on each date of the range", async () => {
    db.runQuery.mockResolvedValueOnce({ items: [{ pk: poolPk("2026-09-05"), sk: "a" }] }).mockResolvedValueOnce({ items: [] });

    const res = parse(await del(event({ httpMethod: "DELETE", queryStringParameters: { startDate: "2026-09-05", endDate: "2026-09-06" } })));

    expect(res.msg).toBe("InventoryPools deleted successfully. Total deleted: 1");
    expect(db.batchTransactData.mock.calls[0][0][0].Key).toEqual({ pk: { S: poolPk("2026-09-05") }, sk: { S: "a" } });
  });

  // The handler has no checkAuthContext, so any caller can delete.
  test.failing("403s a caller without staff on the collection and deletes nothing", async () => {
    const res = parse(await del(adminEvent({ httpMethod: "DELETE", pathParameters: PATH, permissions: { bcparks_9: "staff" }, queryStringParameters: { startDate: "2026-09-05" } })));
    expect(res.status).toBe(403);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("400s without the full path", async () => {
    expect(parse(await del(event({ httpMethod: "DELETE", pathParameters: {} }))).status).toBe(400);
  });
});

describe("PUT inventory pool capacity", () => {
  const putEvent = (body, query = { date: "2026-09-05" }, permissions = { bcparks_7: "staff" }) =>
    adminEvent({ httpMethod: "PUT", pathParameters: PATH, queryStringParameters: query, body, permissions });
  const pool = { pk: poolPk("2026-09-05"), sk: "asset::bcparks_7::parking::1", capacity: 10, availability: 4 };

  it("moves availability by the same amount as capacity and flags a manual edit", async () => {
    db.runQuery.mockResolvedValue({ items: [pool] });

    const res = parse(await put(putEvent({ capacity: 15, notes: "event", isOpen: true, preCloseCapacity: 12 }, { date: "2026-09-05", editMode: "manual" })));

    expect(res.status).toBe(200);
    expect(res.data[0]).toEqual({
      key: { pk: pool.pk, sk: pool.sk },
      data: { capacity: 15, availability: 9, notes: "event", isOpen: true, preCloseCapacity: 12, manuallyEdited: true },
    });
    const update = db.batchTransactData.mock.calls[0][0][0];
    expect(update.action).toBe("Update");
    expect(update.data.ExpressionAttributeValues[":availability"]).toEqual({ N: "9" });
  });

  it("clears the manual flag and preCloseCapacity when asked", async () => {
    db.runQuery.mockResolvedValue({ items: [pool] });

    const res = parse(await put(putEvent({ capacity: 10, preCloseCapacity: null }, { date: "2026-09-05", clearManualEdit: "true" })));

    expect(res.data[0].data).toEqual({ capacity: 10, availability: 4, preCloseCapacity: null, manuallyEdited: false });
  });

  it("refuses to cut capacity below what is already booked", async () => {
    db.runQuery.mockResolvedValue({ items: [pool] });

    const res = parse(await put(putEvent({ capacity: 5 })));

    expect(res.status).toBe(400);
    expect(res.msg).toContain("Cannot reduce capacity below current bookings");
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("refuses a pool whose availability would exceed the new capacity", async () => {
    db.runQuery.mockResolvedValue({ items: [{ ...pool, capacity: 0, availability: 5 }] });

    expect(parse(await put(putEvent({ capacity: 3 }))).msg).toContain("Availability cannot exceed capacity");
  });

  it("404s when the date has no pools", async () => {
    expect(parse(await put(putEvent({ capacity: 3 }))).status).toBe(404);
  });

  it.each([[{}], [{ capacity: -1 }], [{ capacity: "lots" }]])("400s on capacity %j", async (body) => {
    const res = parse(await put(putEvent(body)));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("capacity must be a non-negative number");
  });

  it("400s without a date and 403s a caller below staff", async () => {
    expect(parse(await put(putEvent({ capacity: 1 }, {}))).msg).toBe("Missing required parameters: date");
    expect(parse(await put(putEvent({ capacity: 1 }, { date: "2026-09-05" }, { bcparks_7: "limited" }))).status).toBe(403);
  });
});

describe("PUT pools for one date from an asset list", () => {
  const datePath = { ...PATH, date: "2026-09-05" };
  const putEvent = (body, pathParameters = datePath) => event({ httpMethod: "PUT", pathParameters, body: JSON.stringify(body) });

  it("answers a preflight", async () => {
    expect((await putDate(event({ httpMethod: "OPTIONS" }))).statusCode).toBe(200);
  });

  it("writes the new capacity onto each existing pool it can find", async () => {
    db.getOne.mockImplementation(async (pk, sk) => (sk === "asset::bcparks_7::parking::1" ? { pk, sk, note: "keep" } : undefined));

    const res = parse(await putDate(putEvent({ assets: [{ ...asset, quantity: 30 }, { primaryKey: { pk: "asset::bcparks_7", sk: "missing" } }, { quantity: 2 }] })));

    expect(res.status).toBe(200);
    expect(res.msg).toBe("Successfully updated 1 InventoryPools");
    expect(db.getOne).toHaveBeenCalledWith(poolPk("2026-09-05"), "asset::bcparks_7::parking::1");
    const [[op], action] = db.batchTransactData.mock.calls[0];
    expect(action).toBe("Put");
    expect(unmarshall(op.Item)).toMatchObject({ sk: "asset::bcparks_7::parking::1", capacity: 30, note: "keep" });
  });

  it("400s when no listed asset matches a pool", async () => {
    db.getOne.mockResolvedValue(undefined);

    expect(parse(await putDate(putEvent({ assets: [asset] }))).msg).toBe("No valid assets provided for update");
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("400s without an assets array or full path", async () => {
    expect(parse(await putDate(putEvent({ assets: "x" }))).msg).toBe("Request body must contain an 'assets' array");
    expect(parse(await putDate(putEvent({ assets: [] }, PATH))).msg).toBe("Missing required path parameters");
  });
});
