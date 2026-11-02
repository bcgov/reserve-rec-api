"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { adminEvent, parse } = require("../helpers/adminEvent");
const getAdmin = require("../../src/handlers/products/_collectionId/GET/admin").handler;
const getPublic = require("../../src/handlers/products/_collectionId/GET/public").handler;
const post = require("../../src/handlers/products/_collectionId/POST/admin").handler;
const put = require("../../src/handlers/products/_collectionId/PUT/admin").handler;
const del = require("../../src/handlers/products/_collectionId/DELETE/admin").handler;

const PATH = { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" };
const asset = { primaryKey: { pk: "asset::bcparks_7", sk: "parking::1" }, allocationType: "flex", quantity: 20 };

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
  db.batchWriteData.mockResolvedValue(true);
  db.runQuery.mockResolvedValue({ items: [] });
});

describe("GET products", () => {
  it("answers a CORS preflight on both endpoints", async () => {
    expect((await getAdmin({ httpMethod: "OPTIONS" })).statusCode).toBe(200);
    expect((await getPublic({ httpMethod: "OPTIONS" })).statusCode).toBe(200);
    expect(db.runQuery).not.toHaveBeenCalled();
  });

  it("admin returns the activity's products", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "2", displayName: "AM" }] });

    const res = parse(await getAdmin(adminEvent({ pathParameters: { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1" } })));

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ items: [{ sk: "2", displayName: "AM" }] });
    expect(db.runQuery.mock.calls[0][0].ExpressionAttributeValues[":pk"]).toEqual({ S: "product::bcparks_7::dayuse::1" });
  });

  it("admin refuses a request whose permissions cannot be read", async () => {
    const event = adminEvent({ pathParameters: PATH });
    event.requestContext.authorizer.permissions = "{not json";

    expect(parse(await getAdmin(event)).status).toBe(401);
  });

  it("public reads one product without its admin fields", async () => {
    db.getOne.mockResolvedValue({ sk: "2", displayName: "AM", adminNotes: "internal", creationDate: "x" });

    const res = parse(await getPublic({ httpMethod: "GET", pathParameters: PATH }));

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ sk: "2", displayName: "AM" });
  });

  it("public needs the activity in the path or query", async () => {
    const res = parse(await getPublic({ httpMethod: "GET", pathParameters: { collectionId: "bcparks_7" } }));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("activityType and activityId are required query parameters");
  });
});

describe("POST product", () => {
  const body = { activityType: "dayuse", activityId: 1, displayName: "AM pass", timezone: "America/Vancouver", assetList: [asset] };

  function postEvent(payload, permissions) {
    return adminEvent({ httpMethod: "POST", pathParameters: { collectionId: "bcparks_7" }, body: payload, permissions });
  }

  it("creates the product and its activity relationship", async () => {
    db.incrementCounter.mockResolvedValue(4);
    db.getOne.mockResolvedValue({ activitySubType: "walkin" });

    const res = parse(await post(postEvent(body)));

    expect(res.status).toBe(200);
    const putOp = db.batchTransactData.mock.calls[0][0][0];
    expect(putOp.action).toBe("Put");
    expect(putOp.data.ConditionExpression).toBe("attribute_not_exists(pk) AND attribute_not_exists(sk)");
    const item = unmarshall(putOp.data.Item);
    expect(item).toMatchObject({
      pk: "product::bcparks_7::dayuse::1", sk: "4", productId: 4, identifier: 4, activityId: 1,
      schema: "product", collectionId: "bcparks_7", activitySubType: "walkin", version: 1, displayName: "AM pass",
    });
    expect(item).not.toHaveProperty("activities");
    const [relationships] = db.batchWriteData.mock.calls[0];
    expect(relationships).toHaveLength(1);
    expect(JSON.stringify(relationships[0])).toContain("activity::bcparks_7");
  });

  it("rejects an assetList entry with an unknown allocationType", async () => {
    db.incrementCounter.mockResolvedValue(4);
    db.getOne.mockResolvedValue({});

    const res = parse(await post(postEvent({ ...body, assetList: [{ ...asset, allocationType: "pool" }] })));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Validation failed for field 'assetList'");
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("rejects a product missing a mandatory field", async () => {
    db.incrementCounter.mockResolvedValue(4);
    db.getOne.mockResolvedValue({});

    const res = parse(await post(postEvent({ activityType: "dayuse", activityId: 1, displayName: "AM" })));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Mandatory field 'timezone' is missing in the request");
  });

  it("rejects a batch item without its activity", async () => {
    const event = postEvent([{ activityType: "dayuse", activityId: 1 }, { displayName: "no activity" }]);
    event.queryStringParameters = { activityType: "dayuse", activityId: "1" };
    const res = parse(await post(event));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Each item in body must include activityType and activityId");
  });

  it("requires a body", async () => {
    const res = parse(await post(postEvent(null)));

    expect(res.status).toBe(400);
    expect(res.msg).toContain("Missing required parameters: body");
  });

  it("is superadmin only", async () => {
    const res = parse(await post(postEvent(body, { bcparks_7: "staff" })));

    expect(res.status).toBe(403);
    expect(db.incrementCounter).not.toHaveBeenCalled();
  });
});

describe("PUT product", () => {
  function putEvent(payload, permissions = { bcparks_7: "staff" }) {
    return adminEvent({ httpMethod: "PUT", pathParameters: PATH, body: payload, permissions });
  }

  it("lets collection staff update fields of the addressed product", async () => {
    const res = parse(await put(putEvent({ displayName: "Renamed", productId: 99 })));

    expect(res.status).toBe(200);
    const update = db.batchTransactData.mock.calls[0][0][0];
    expect(update.action).toBe("Update");
    expect(unmarshall(update.data.Key)).toEqual({ pk: "product::bcparks_7::dayuse::1", sk: "2" });
    expect(update.data.ExpressionAttributeValues[":displayName"]).toEqual({ S: "Renamed" });
    expect(update.data.ConditionExpression).toBe("attribute_exists(pk)");
    expect(update.data.ExpressionAttributeNames).not.toHaveProperty("#productId");
  });

  it("pushes a new assetList down to future ProductDates and their pools", async () => {
    db.runQuery
      .mockResolvedValueOnce({ items: [{ pk: "productDate::bcparks_7::dayuse::1::2", sk: "2099-01-01", assetList: [{ ...asset, quantity: 10 }] }] })
      .mockResolvedValueOnce({ items: [{ pk: "inventoryPool::bcparks_7::dayuse::1::2::2099-01-01", sk: "asset::bcparks_7::parking::1", capacity: 10, availability: 7 }] });

    const res = parse(await put(putEvent({ assetList: [asset] })));

    expect(res.status).toBe(200);
    expect(db.runQuery.mock.calls[0][0].ExpressionAttributeValues[":pk"]).toEqual({ S: "productDate::bcparks_7::dayuse::1::2" });
    expect(db.runQuery.mock.calls[1][0].ExpressionAttributeValues[":pk"]).toEqual({ S: "inventoryPool::bcparks_7::dayuse::1::2::2099-01-01" });
    const pool = unmarshall(db.batchTransactData.mock.calls[2][0][0].Item);
    expect(pool).toMatchObject({ capacity: 20, availability: 17 });
  });

  it("still reports success when the cascade fails after the product was saved", async () => {
    db.runQuery.mockRejectedValue(new Error("throttled"));

    const res = parse(await put(putEvent({ assetList: [asset] })));

    expect(res.status).toBe(200);
    expect(db.batchTransactData).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid field value", async () => {
    const res = parse(await put(putEvent({ isVisible: "yes" })));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Validation failed for field 'isVisible'");
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("rejects a batch item without its product id", async () => {
    const res = parse(await put(putEvent([{ activityType: "dayuse", activityId: 1 }])));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Each item in body must include activityType, activityId, and productId");
  });

  it("requires a body", async () => {
    const res = parse(await put(putEvent(null)));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Cannot create product - missing required parameter(s): body");
  });

  it("refuses a caller with a lower tier on the collection", async () => {
    expect(parse(await put(putEvent({ displayName: "x" }, { bcparks_7: "limited" }))).status).toBe(403);
  });
});

describe("DELETE product", () => {
  function delEvent(overrides = {}, permissions) {
    return adminEvent({ httpMethod: "DELETE", pathParameters: PATH, ...overrides, permissions });
  }

  it("removes the product's relationships and soft-deletes it", async () => {
    db.runQuery
      .mockResolvedValueOnce({ items: [{ pk: "rel::product::bcparks_7::dayuse::1::2", sk: "activity::x" }] })
      .mockResolvedValueOnce({ items: [] });

    const res = parse(await del(delEvent()));

    expect(res.status).toBe(200);
    expect(res.data.relationshipsDeleted).toBe(1);
    expect(db.runQuery.mock.calls[0][0].ExpressionAttributeValues[":pk"]).toEqual({ S: "rel::product::bcparks_7::dayuse::1::2" });
    const softDelete = db.batchTransactData.mock.calls[1][0][0];
    expect(softDelete.action).toBe("Update");
    expect(unmarshall(softDelete.data.Key)).toEqual({ pk: "product::bcparks_7::dayuse::1", sk: "2" });
    expect(softDelete.data.UpdateExpression).toContain("isDeleted = :true");
    expect(unmarshall(softDelete.data.ExpressionAttributeValues)).toMatchObject({ ":true": true, ":deletedBy": "user-1" });
  });

  it("refuses a body", async () => {
    const res = parse(await del(delEvent({ body: { x: 1 } })));

    expect(res.status).toBe(400);
    expect(res.msg).toBe("Body is not allowed");
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });

  it("needs the full product path", async () => {
    const res = parse(await del(delEvent({ pathParameters: { collectionId: "bcparks_7" } })));

    expect(res.status).toBe(400);
  });

  it("is superadmin only", async () => {
    expect(parse(await del(delEvent({}, { bcparks_7: "staff" }))).status).toBe(403);
  });
});
