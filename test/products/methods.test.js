"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const {
  fetchProducts,
  getProductByProductId,
  getProductsByActivityType,
  parseRequest,
  resolvePolicyReferences,
  getProductById,
} = require("../../src/handlers/products/methods");

const superadmin = { permissions: { superadmin: "superadmin" } };

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
});

describe("fetchProducts", () => {
  it("queries the activity's product partition and hides drafts from public callers", async () => {
    db.runQuery.mockResolvedValue({ items: [] });

    await fetchProducts("bcparks_7", "dayuse", "1", null, {}, undefined);

    const query = db.runQuery.mock.calls[0][0];
    expect(query.ExpressionAttributeValues[":pk"]).toEqual({ S: "product::bcparks_7::dayuse::1" });
    expect(query.FilterExpression).toContain("#isDeleted");
    expect(query.FilterExpression).toContain("#isVisible");
    expect(query.ExpressionAttributeValues[":visible"]).toEqual({ BOOL: true });
  });

  it("lets staff of the collection see drafts", async () => {
    db.runQuery.mockResolvedValue({ items: [] });

    await fetchProducts("bcparks_7", "dayuse", "1", null, {}, { permissions: { bcparks_7: "staff" } });

    expect(db.runQuery.mock.calls[0][0].FilterExpression).not.toContain("#isVisible");
  });

  it("turns allowed query params into filters, converting 'true'/'false' to booleans", async () => {
    db.runQuery.mockResolvedValue({ items: [] });

    await fetchProducts("bcparks_7", "dayuse", "1", null, { isVisible: "false", activityType: "dayuse", productId: "3", other: "x" }, superadmin);

    const query = db.runQuery.mock.calls[0][0];
    expect(query.FilterExpression).toContain("#isVisible = :isVisible");
    expect(query.FilterExpression).toContain("contains(#activityType, :activityType)");
    expect(query.FilterExpression).toContain("#productId = :productId");
    expect(query.ExpressionAttributeValues[":isVisible"]).toEqual({ BOOL: false });
    expect(query.ExpressionAttributeValues[":productId"]).toEqual({ S: "3" });
    expect(query.FilterExpression).not.toContain("other");
  });

  it("returns a single product by id, stripping admin-only fields for the public", async () => {
    db.getOne.mockResolvedValue({ pk: "product::bcparks_7::dayuse::1", sk: "2", displayName: "AM", adminNotes: "secret", version: 4 });

    const res = await fetchProducts("bcparks_7", "dayuse", "1", "2", {}, undefined);

    expect(db.getOne).toHaveBeenCalledWith("product::bcparks_7::dayuse::1", "2");
    expect(res).toEqual({ pk: "product::bcparks_7::dayuse::1", sk: "2", displayName: "AM" });
  });

  it("keeps admin fields for a superadmin", async () => {
    db.getOne.mockResolvedValue({ sk: "2", adminNotes: "secret" });

    expect(await fetchProducts("bcparks_7", "dayuse", "1", "2", {}, superadmin)).toEqual({ sk: "2", adminNotes: "secret" });
  });

  it("treats a soft-deleted product as not found", async () => {
    db.getOne.mockResolvedValue({ sk: "2", isDeleted: true });

    expect(await getProductByProductId("bcparks_7", "dayuse", "1", "2")).toBeNull();
  });

  it("rejects a missing collectionId, activityType or activityId", async () => {
    await expect(fetchProducts(undefined, "dayuse", "1")).rejects.toMatchObject({ code: 400 });
    await expect(fetchProducts("bcparks_7", null, "1", null, {})).rejects.toMatchObject({ code: 400 });
    await expect(getProductByProductId("bcparks_7", "dayuse", "1", null)).rejects.toMatchObject({ code: 400, message: "Error getting product" });
  });

  it("wraps a database failure as a 400", async () => {
    db.runQuery.mockRejectedValue(new Error("throttled"));

    await expect(fetchProducts("bcparks_7", "dayuse", "1", null, {}, superadmin)).rejects.toMatchObject({ code: 400, message: "Error getting products" });
  });
});

describe("getProductsByActivityType", () => {
  it("queries the partition with filters and the visible-only clause", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "1" }] });

    const res = await getProductsByActivityType("bcparks_7", "dayuse", "1", { isVisible: true }, { limit: 5 }, true);

    expect(res.items).toEqual([{ sk: "1" }]);
    const [query, limit] = db.runQuery.mock.calls[0];
    expect(limit).toBe(5);
    expect(query.FilterExpression).toContain("#isVisible = :isVisible");
    expect(query.ExpressionAttributeValues[":visible"]).toEqual({ BOOL: true });
  });

  it("requires all three keys", async () => {
    await expect(getProductsByActivityType("bcparks_7", "dayuse")).rejects.toMatchObject({ code: 400 });
    expect(db.runQuery).not.toHaveBeenCalled();
  });
});

describe("parseRequest PUT", () => {
  it("keys on the path ids and strips identity fields from the update", async () => {
    const [req] = await parseRequest("bcparks_7", { displayName: "New", pk: "x", sk: "y", productId: 9, activityType: "z", identifier: 9 }, "PUT", "dayuse", "1", "2");

    expect(req).toEqual({ key: { pk: "product::bcparks_7::dayuse::1", sk: "2" }, data: { displayName: "New" } });
  });

  it("takes activity and product ids from each item of a batch", async () => {
    const reqs = await parseRequest("bcparks_7", [
      { activityType: "dayuse", activityId: 1, productId: 2, displayName: "A" },
      { activityType: "dayuse", activityId: 3, productId: 4, displayName: "B" },
    ], "PUT");

    expect(reqs.map((r) => r.key)).toEqual([
      { pk: "product::bcparks_7::dayuse::1", sk: "2" },
      { pk: "product::bcparks_7::dayuse::3", sk: "4" },
    ]);
  });

  it("refuses missing ids", async () => {
    await expect(parseRequest(null, {}, "PUT", "dayuse", "1", "2")).rejects.toThrow("collectionId is required");
    await expect(parseRequest("c", {}, "PUT", null, "1", "2")).rejects.toThrow("activityType is not specified");
    await expect(parseRequest("c", {}, "PUT", "dayuse", null, "2")).rejects.toThrow("activityId is not specified");
    await expect(parseRequest("c", {}, "PUT", "dayuse", "1")).rejects.toThrow("productId is required for PUT");
  });
});

describe("parseRequest POST", () => {
  it("assigns the next productId and inherits activitySubType from the activity", async () => {
    db.incrementCounter.mockResolvedValue(5);
    db.getOne.mockResolvedValue({ activitySubType: "walkin" });

    const [req] = await parseRequest("bcparks_7", { displayName: "AM", creationDate: "old", version: 3 }, "POST", "dayuse", "1");

    expect(db.incrementCounter).toHaveBeenCalledWith("product::bcparks_7::dayuse::1");
    expect(db.getOne).toHaveBeenCalledWith("activity::bcparks_7", "dayuse::1");
    expect(req.key).toEqual({ pk: "product::bcparks_7::dayuse::1", sk: "5" });
    expect(req.data).toMatchObject({
      schema: "product", collectionId: "bcparks_7", activityType: "dayuse",
      activityId: 1, productId: 5, identifier: 5, activitySubType: "walkin", displayName: "AM",
    });
    expect(req.data.globalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.data).not.toHaveProperty("creationDate");
    expect(req.data).not.toHaveProperty("version");
  });

  it("leaves activitySubType off when the activity has none, and keeps one given explicitly", async () => {
    db.incrementCounter.mockResolvedValue(1);
    db.getOne.mockResolvedValue({});

    const [noSub] = await parseRequest("c", { activitySubType: null }, "POST", "dayuse", "1");
    const [explicit] = await parseRequest("c", { activitySubType: "rv", globalId: "g-1" }, "POST", "dayuse", "1");

    expect(noSub.data).not.toHaveProperty("activitySubType");
    expect(explicit.data.activitySubType).toBe("rv");
    expect(explicit.data.globalId).toBe("g-1");
    expect(db.getOne).toHaveBeenCalledTimes(1);
  });

  it("refuses a client-chosen productId", async () => {
    await expect(parseRequest("c", { productId: 3 }, "POST", "dayuse", "1")).rejects.toThrow("Can't specify productId");
    expect(db.incrementCounter).not.toHaveBeenCalled();
  });
});

describe("resolvePolicyReferences", () => {
  it("copies the product-level fields of each referenced policy", async () => {
    const policies = {
      "policy::reservation|r1": { isDiscoverable: false, holdDuration: { minutes: 5 }, temporalWindows: { discoveryWindow: { open: 1 }, other: {} }, extra: "x" },
      "policy::party|p1": { partyCategories: ["adult"], partyCompositionRules: { max: 4 } },
      "policy::fee|f1": { feeSchedule: { a: 1 }, lineItems: [1] },
      "policy::change|c1": { rules: ["no"] },
    };
    db.getOne.mockImplementation(async (pk, sk) => policies[`${pk}|${sk}`]);

    const item = await resolvePolicyReferences({
      displayName: "AM",
      reservationPolicy: { pk: "policy::reservation", sk: "r1" },
      partyPolicy: { pk: "policy::party", sk: "p1" },
      feePolicy: { pk: "policy::fee", sk: "f1" },
      changePolicy: { pk: "policy::change", sk: "c1" },
    });

    expect(item.reservationPolicy).toEqual({
      primaryKey: { pk: "policy::reservation", sk: "r1" },
      isDiscoverable: false, isReservable: true, minTotalDays: 1, maxTotalDays: 14,
      holdDuration: { minutes: 5 }, temporalWindows: { discoveryWindow: { open: 1 } },
    });
    expect(item.partyPolicy).toEqual({ primaryKey: { pk: "policy::party", sk: "p1" }, partyCategories: ["adult"], partyCompositionRules: { max: 4 } });
    expect(item.feePolicy).toEqual({ primaryKey: { pk: "policy::fee", sk: "f1" }, feeSchedule: { a: 1 }, lineItems: [1] });
    expect(item.changePolicy).toEqual({ primaryKey: { pk: "policy::change", sk: "c1" }, rules: ["no"] });
  });

  it("leaves an already-resolved policy alone", async () => {
    const resolved = { primaryKey: { pk: "policy::fee", sk: "f1" }, lineItems: [] };

    expect((await resolvePolicyReferences({ feePolicy: resolved })).feePolicy).toBe(resolved);
    expect(db.getOne).not.toHaveBeenCalled();
  });

  it("fails with 400 when a referenced policy does not exist", async () => {
    db.getOne.mockResolvedValue(undefined);

    await expect(resolvePolicyReferences({ partyPolicy: { pk: "policy::party", sk: "gone" } }))
      .rejects.toMatchObject({ code: 400, message: "Failed to resolve partyPolicy: Policy not found: policy::party::gone" });
  });
});

describe("getProductById", () => {
  it("reads the product row by its keys", async () => {
    db.getOne.mockResolvedValue({ sk: "2", displayName: "AM" });

    expect(await getProductById("c", "dayuse", "1", "2")).toEqual({ sk: "2", displayName: "AM" });
    expect(db.getOne).toHaveBeenCalledWith("product::c::dayuse::1", "2");
  });

  it("wraps a lookup failure as a 400", async () => {
    db.getOne.mockRejectedValue(new Error("down"));

    await expect(getProductById("c", "dayuse", "1", "2")).rejects.toMatchObject({ code: 400, message: "Error getting product" });
  });
});
