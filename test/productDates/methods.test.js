"use strict";

jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());

const db = require("/opt/dynamodb");
const {
  fetchProductDates,
  fetchProductDateByDate,
  initializeProductDates,
  deleteProductDates,
  syncAssetListToProductDates,
} = require("../../src/handlers/productDates/methods");

const KEYS = { collectionId: "bcparks_7", activityType: "dayuse", activityId: "1", productId: "2" };
const PK = "productDate::bcparks_7::dayuse::1::2";

beforeEach(() => {
  jest.resetAllMocks();
  db.batchTransactData.mockResolvedValue(true);
});

describe("fetchProductDates", () => {
  it("reads a date range and only returns dates whose discovery window is open now", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "2026-09-05" }] });

    const res = await fetchProductDates({ ...KEYS, startDate: "2026-09-05", endDate: "2026-09-07", queryTime: 1700000000000 });

    expect(res).toEqual([{ sk: "2026-09-05" }]);
    const q = db.runQuery.mock.calls[0][0];
    expect(q.KeyConditionExpression).toBe("pk = :pk AND sk BETWEEN :startDate AND :endDate");
    expect(q.ExpressionAttributeValues).toMatchObject({
      ":pk": { S: PK }, ":startDate": { S: "2026-09-05" }, ":endDate": { S: "2026-09-07" },
      ":isDiscoverable": { BOOL: true }, ":currentDateTime": { N: "1700000000000" },
    });
    expect(q.FilterExpression).toContain("#discoveryWindow.#open <= :currentDateTime");
  });

  it("skips discovery rules when bypassed and projects only the requested fields", async () => {
    db.runQuery.mockResolvedValue([{ sk: "a" }]);

    const res = await fetchProductDates({ ...KEYS, bypassDiscoveryRules: true, projectionFields: ["pk", "date"] });

    expect(res).toEqual([{ sk: "a" }]);
    const q = db.runQuery.mock.calls[0][0];
    expect(q.KeyConditionExpression).toBe("pk = :pk");
    expect(q.FilterExpression).toBeUndefined();
    expect(q.ProjectionExpression).toBe("#pk, #date");
    expect(q.ExpressionAttributeNames).toEqual({ "#pk": "pk", "#date": "date" });
  });

  it("passes a database error through", async () => {
    db.runQuery.mockRejectedValue(new Error("down"));

    await expect(fetchProductDates(KEYS)).rejects.toThrow("down");
  });
});

describe("fetchProductDateByDate", () => {
  it("reads one date by key with discovery rules applied", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "2026-09-05" }] });

    expect(await fetchProductDateByDate({ ...KEYS, date: "2026-09-05" })).toEqual([{ sk: "2026-09-05" }]);
    const q = db.runQuery.mock.calls[0][0];
    expect(q.KeyConditionExpression).toBe("pk = :pk AND sk = :sk");
    expect(q.ExpressionAttributeValues[":sk"]).toEqual({ S: "2026-09-05" });
    expect(q.FilterExpression).toContain("#isDiscoverable");
  });

  it("returns an empty list for an empty result and can bypass discovery", async () => {
    db.runQuery.mockResolvedValue(undefined);

    expect(await fetchProductDateByDate({ ...KEYS, date: "2026-09-05", bypassDiscoveryRules: true })).toEqual([]);
    expect(db.runQuery.mock.calls[0][0].FilterExpression).toBeUndefined();
  });

  it("passes a database error through", async () => {
    db.runQuery.mockRejectedValue(new Error("down"));

    await expect(fetchProductDateByDate({ ...KEYS, date: "2026-09-05" })).rejects.toThrow("down");
  });
});

describe("initializeProductDates", () => {
  const reservationPolicy = {
    productDateRules: {
      isReservable: true,
      maxDailyInventory: 300,
      temporalAnchors: [{ id: "opening", anchorRef: "productDate", timeOfDay: { hour: 7, minute: 0, second: 0 } }],
      temporalWindows: [{
        id: "discoveryWindow",
        open: { anchorRef: "productDate", duration: { days: 2, direction: "before" }, timeOfDay: { hour: 7, minute: 0, second: 0 } },
        close: { anchorRef: "productDate", timeOfDay: { hour: 23, minute: 0, second: 0 } },
      }],
    },
  };
  const product = {
    displayName: "AM pass",
    timezone: "America/Vancouver",
    rangeStart: "2026-09-05",
    rangeEnd: "2026-09-06",
    assetList: [{ primaryKey: { pk: "asset::bcparks_7", sk: "parking::1" }, quantity: 20 }],
    reservationPolicy: { primaryKey: { pk: "policy::reservation", sk: "r1" } },
    partyPolicy: { primaryKey: { pk: "policy::party", sk: "p1" } },
  };

  function stubReads(productRow = product) {
    db.getOne.mockImplementation(async (pk) => ({
      "product::bcparks_7::dayuse::1": productRow,
      "policy::reservation": reservationPolicy,
      "policy::party": { maxSize: 4 },
    })[pk]);
  }

  it("builds one ProductDate per day of the product's range with its resolved windows", async () => {
    stubReads();

    const dates = await initializeProductDates("bcparks_7", "dayuse", "1", "2");

    expect(dates.map((d) => d.sk)).toEqual(["2026-09-05", "2026-09-06"]);
    const first = dates[0];
    expect(first).toMatchObject({
      pk: PK, schema: "productDate", date: "2026-09-05", displayName: "AM pass - 2026-09-05",
      assetList: product.assetList, partyPolicy: { maxSize: 4 }, changePolicy: null, feePolicy: null,
      reservationPolicy: reservationPolicy.productDateRules,
    });
    expect(first.reservationContext.maxDailyInventory).toBe(300);
    expect(first.reservationContext.temporalAnchors.opening).toBe(Date.parse("2026-09-05T14:00:00Z"));
    expect(first.reservationContext.temporalWindows.discoveryWindow).toMatchObject({
      open: Date.parse("2026-09-03T14:00:00Z"),
      close: Date.parse("2026-09-06T06:00:00Z"),
    });
  });

  it("uses the start date as a single day when neither request nor product has an end", async () => {
    stubReads({ ...product, rangeEnd: undefined });

    const dates = await initializeProductDates("bcparks_7", "dayuse", "1", "2", "2026-10-01");

    expect(dates.map((d) => d.date)).toEqual(["2026-10-01"]);
  });

  it("404s when the product does not exist", async () => {
    db.getOne.mockResolvedValue(undefined);

    await expect(initializeProductDates("bcparks_7", "dayuse", "1", "2")).rejects.toMatchObject({ code: 404 });
  });

  it("400s when neither the request nor the product gives a start date", async () => {
    db.getOne.mockResolvedValue({ displayName: "no range" });

    await expect(initializeProductDates("bcparks_7", "dayuse", "1", "2")).rejects.toMatchObject({ code: 400 });
  });
});

describe("deleteProductDates", () => {
  it("deletes every day in the given range", async () => {
    expect(await deleteProductDates("bcparks_7", "dayuse", "1", "2", "2026-09-05", "2026-09-07")).toBe(3);

    const [items, action] = db.batchTransactData.mock.calls[0];
    expect(action).toBe("Delete");
    expect(items.map((i) => i.Key)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"].map((d) => ({ pk: { S: PK }, sk: { S: d } })));
    expect(db.getOne).not.toHaveBeenCalled();
  });

  it("falls back to the product's range", async () => {
    db.getOne.mockResolvedValue({ rangeStart: "2026-09-05", rangeEnd: "2026-09-06" });

    expect(await deleteProductDates("bcparks_7", "dayuse", "1", "2")).toBe(2);
  });

  it("deletes the single start day when the product has no end", async () => {
    db.getOne.mockResolvedValue({ rangeStart: "2026-09-05" });

    expect(await deleteProductDates("bcparks_7", "dayuse", "1", "2")).toBe(1);
  });

  it("400s without any start date", async () => {
    db.getOne.mockResolvedValue({});

    await expect(deleteProductDates("bcparks_7", "dayuse", "1", "2")).rejects.toMatchObject({ code: 400 });
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });
});

describe("syncAssetListToProductDates", () => {
  it("adds assets new to the product and drops ones it no longer has", async () => {
    const kept = { primaryKey: { pk: "asset::c", sk: "a" }, quantity: 5, label: "lot A" };
    db.runQuery.mockResolvedValue({ items: [{ pk: PK, sk: "2099-01-01", assetList: [kept, { primaryKey: { pk: "asset::c", sk: "gone" }, quantity: 1 }] }] });

    await syncAssetListToProductDates({ ...KEYS, assetList: [{ primaryKey: { pk: "asset::c", sk: "a" }, quantity: 9 }, { primaryKey: { pk: "asset::c", sk: "new" }, quantity: 2 }] });

    const written = db.unmarshall(db.batchTransactData.mock.calls[0][0][0].Item);
    expect(written.assetList).toEqual([
      { primaryKey: { pk: "asset::c", sk: "a" }, quantity: 9, label: "lot A" },
      { primaryKey: { pk: "asset::c", sk: "new" }, quantity: 2 },
    ]);
  });

  it("writes nothing when every date is manually overridden", async () => {
    db.runQuery.mockResolvedValue({ items: [{ sk: "2099-01-01", assetListManuallyEdited: true }] });

    expect(await syncAssetListToProductDates({ ...KEYS, assetList: [{ primaryKey: { pk: "a", sk: "b" }, quantity: 1 }] })).toEqual([]);
    expect(db.batchTransactData).not.toHaveBeenCalled();
  });
});
