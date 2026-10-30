"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { adminEvent, parse } = require("../helpers/adminEvent");
const getAdmin = require("../../src/handlers/productDates/_productId/GET/admin").handler;
const getPublic = require("../../src/handlers/productDates/_productId/GET/public").handler;
const post = require("../../src/handlers/productDates/_productId/POST/admin").handler;
const del = require("../../src/handlers/productDates/_productId/DELETE/admin").handler;
const putDate = require("../../src/handlers/productDates/_productId/_date/PUT/admin").handler;

const PATH = { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" };
const PK = "productDate::bcparks_7::dayuse::1::2";
const signedIn = { authorizer: { isAuthenticated: "true" } };

const event = (overrides = {}) => ({ httpMethod: "GET", pathParameters: PATH, queryStringParameters: null, body: null, ...overrides });
const queryOf = (n = 0) => db.runQuery.mock.calls[n][0];

beforeEach(() => {
  jest.resetAllMocks();
  db.runQuery.mockResolvedValue({ items: [{ sk: "2026-09-05" }] });
  db.batchTransactData.mockResolvedValue(true);
});

afterEach(() => jest.useRealTimers());

describe("GET product dates (admin)", () => {
  it("answers a preflight", async () => {
    expect((await getAdmin(event({ httpMethod: "OPTIONS" }))).statusCode).toBe(200);
  });

  it("reads a range, honouring bypassDiscoveryRules=true", async () => {
    const res = parse(await getAdmin(event({ queryStringParameters: { startDate: "2026-09-05", endDate: "2026-09-07", bypassDiscoveryRules: "true" } })));

    expect(res.status).toBe(200);
    expect(res.data).toEqual([{ sk: "2026-09-05" }]);
    expect(queryOf().KeyConditionExpression).toBe("pk = :pk AND sk BETWEEN :startDate AND :endDate");
    expect(queryOf().FilterExpression).toBeUndefined();
  });

  it("reads a single date by key when only date is given, with discovery rules on", async () => {
    await getAdmin(event({ queryStringParameters: { date: "2026-09-05" } }));

    expect(queryOf().KeyConditionExpression).toBe("pk = :pk AND sk = :sk");
    expect(queryOf().FilterExpression).toContain("#isDiscoverable");
  });

  it("treats a start date alone as that one day", async () => {
    await getAdmin(event({ queryStringParameters: { startDate: "2026-09-05" } }));

    expect(queryOf().ExpressionAttributeValues[":sk"]).toEqual({ S: "2026-09-05" });
  });

  it("defaults to the next two weeks", async () => {
    await getAdmin(event());

    const v = queryOf().ExpressionAttributeValues;
    expect((Date.parse(v[":endDate"].S) - Date.parse(v[":startDate"].S)) / 86400000).toBe(14);
  });

  it("400s without the full product path and on a database error", async () => {
    expect(parse(await getAdmin(event({ pathParameters: { collectionId: "bcparks_7" } }))).status).toBe(400);
    db.runQuery.mockRejectedValue(new Error("down"));
    expect(parse(await getAdmin(event({ queryStringParameters: { date: "2026-09-05" } }))).msg).toBe("down");
  });
});

describe("GET product dates (public)", () => {
  it("answers a preflight", async () => {
    expect((await getPublic(event({ httpMethod: "OPTIONS" }))).statusCode).toBe(200);
  });

  it("caps a range at one month and projects public fields only", async () => {
    await getPublic(event({ requestContext: signedIn, queryStringParameters: { startDate: "2026-09-05", endDate: "2026-12-31" } }));

    expect(queryOf().ExpressionAttributeValues[":endDate"]).toEqual({ S: "2026-10-05" });
    expect(queryOf().ProjectionExpression).toContain("#reservationContext");
    expect(queryOf().ProjectionExpression).not.toContain("#partyPolicy");
  });

  it("always applies discovery rules, even when asked to bypass", async () => {
    await getPublic(event({ requestContext: signedIn, queryStringParameters: { startDate: "2026-09-05", endDate: "2026-09-06", bypassDiscoveryRules: "true" } }));

    expect(queryOf().FilterExpression).toContain("#isDiscoverable");
  });

  it("defaults to two weeks and 400s on an incomplete path", async () => {
    await getPublic(event({ requestContext: signedIn }));
    const v = queryOf().ExpressionAttributeValues;
    expect((Date.parse(v[":endDate"].S) - Date.parse(v[":startDate"].S)) / 86400000).toBe(14);

    expect(parse(await getPublic(event({ requestContext: signedIn, pathParameters: { collectionId: "x" } }))).status).toBe(400);
  });
});

describe("POST product dates", () => {
  const product = {
    displayName: "AM",
    timezone: "America/Vancouver",
    reservationPolicy: { primaryKey: { pk: "policy::reservation", sk: "r1" } },
  };
  const policy = { productDateRules: { temporalAnchors: [], temporalWindows: [] } };

  function stubReads() {
    db.getOne.mockImplementation(async (pk) => (pk.startsWith("product::") ? product : policy));
  }

  const postEvent = (q = { startDate: "2026-09-05", endDate: "2026-09-06" }) => event({ httpMethod: "POST", queryStringParameters: q });

  it("answers a preflight", async () => {
    expect((await post(event({ httpMethod: "OPTIONS" }))).statusCode).toBe(200);
  });

  it("writes a ProductDate per day and returns them", async () => {
    stubReads();

    const res = parse(await post(postEvent()));

    expect(res.status).toBe(200);
    expect(res.data.map((d) => d.sk)).toEqual(["2026-09-05", "2026-09-06"]);
    const puts = db.batchTransactData.mock.calls[0][0];
    expect(puts.map((p) => unmarshall(p.data.Item).sk)).toEqual(["2026-09-05", "2026-09-06"]);
    expect(unmarshall(puts[0].data.Item)).toMatchObject({ pk: PK, version: 1, schema: "productDate" });
    expect(puts[0].data.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
  });

  it("treats already-existing dates as success", async () => {
    stubReads();
    db.batchTransactData.mockRejectedValue(new Error("Transaction cancelled [ConditionalCheckFailed]"));

    const res = parse(await post(postEvent()));

    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(2);
    expect(db.batchTransactData).toHaveBeenCalledTimes(1);
  });

  it("retries a transient write failure", async () => {
    jest.useFakeTimers();
    stubReads();
    db.batchTransactData.mockRejectedValueOnce(new Error("throttled")).mockResolvedValue(true);

    const pending = post(postEvent());
    await jest.advanceTimersByTimeAsync(100);
    const res = parse(await pending);

    expect(res.status).toBe(200);
    expect(db.batchTransactData).toHaveBeenCalledTimes(2);
  });

  it("gives up after four failed writes", async () => {
    jest.useFakeTimers();
    stubReads();
    db.batchTransactData.mockRejectedValue(new Error("throttled"));

    const pending = post(postEvent());
    await jest.advanceTimersByTimeAsync(600);
    const res = parse(await pending);

    expect(res.status).toBe(400);
    expect(res.msg).toBe("throttled");
    expect(db.batchTransactData).toHaveBeenCalledTimes(4);
  });

  it("returns an empty success when the range holds no days", async () => {
    stubReads();

    const res = parse(await post(postEvent({ startDate: "2026-09-06", endDate: "2026-09-05" })));

    expect(res.status).toBe(200);
    expect(res.data).toEqual([]);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("404s for an unknown product", async () => {
    db.getOne.mockResolvedValue(undefined);

    expect(parse(await post(postEvent())).status).toBe(404);
  });
});

describe("DELETE product dates", () => {
  it("deletes the body's date range", async () => {
    const res = parse(await del(event({ httpMethod: "DELETE", body: JSON.stringify({ startDate: "2026-09-05", endDate: "2026-09-06" }) })));

    expect(res.status).toBe(200);
    expect(res.msg).toBe("Product Dates deleted successfully. Total deleted: 2");
    expect(db.batchTransactData.mock.calls[0][1]).toBe("Delete");
  });

  // The handler has no checkAuthContext, so any caller can delete.
  test.failing("403s a caller without staff on the collection and deletes nothing", async () => {
    const res = parse(await del(adminEvent({ httpMethod: "DELETE", pathParameters: PATH, permissions: { bcparks_9: "staff" }, body: { startDate: "2026-09-05" } })));
    expect(res.status).toBe(403);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("400s without the full product path", async () => {
    expect(parse(await del(event({ httpMethod: "DELETE", pathParameters: {} }))).status).toBe(400);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });
});

describe("PUT one product date", () => {
  const datePath = { ...PATH, date: "2026-09-05" };
  const existing = { pk: PK, sk: "2026-09-05", assetList: [{ quantity: 10 }], reservationContext: { isReservable: true, maxDailyInventory: 10 } };
  const putEvent = (body, pathParameters = datePath) => event({ httpMethod: "PUT", pathParameters, body: JSON.stringify(body) });

  it("answers a preflight", async () => {
    expect((await putDate(event({ httpMethod: "OPTIONS" }))).statusCode).toBe(200);
  });

  it("overrides the date's assetList and flags it as manually edited", async () => {
    db.getOne.mockResolvedValue(existing);

    const res = parse(await putDate(putEvent({ assetList: [{ quantity: 4 }], reservationContext: { isReservable: false } })));

    expect(res.status).toBe(200);
    expect(db.getOne).toHaveBeenCalledWith(PK, "2026-09-05");
    const [[op], action] = db.batchTransactData.mock.calls[0];
    expect(action).toBe("Put");
    expect(op.ConditionExpression).toBe("attribute_exists(pk)");
    expect(unmarshall(op.Item)).toMatchObject({
      assetList: [{ quantity: 4 }],
      assetListManuallyEdited: true,
      reservationContext: { isReservable: false, maxDailyInventory: 10 },
    });
  });

  it("does not flag a date whose assetList was not touched", async () => {
    db.getOne.mockResolvedValue(existing);

    await putDate(putEvent({ reservationContext: { isReservable: false } }));

    const item = unmarshall(db.batchTransactData.mock.calls[0][0][0].Item);
    expect(item.assetList).toEqual([{ quantity: 10 }]);
    expect(item).not.toHaveProperty("assetListManuallyEdited");
  });

  it("404s for a missing date, 400s for a missing body or path", async () => {
    db.getOne.mockResolvedValue(undefined);
    expect(parse(await putDate(putEvent({ assetList: [] }))).status).toBe(404);
    expect(parse(await putDate(event({ httpMethod: "PUT", pathParameters: datePath, body: "null" }))).msg).toBe("Request body is required");
    expect(parse(await putDate(putEvent({}, PATH))).msg).toBe("Missing required path parameters");
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });
});
