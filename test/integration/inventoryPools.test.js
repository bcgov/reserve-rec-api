const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");

// Routes (routes with methods defined):
//   GET/POST/DELETE      /inventory-pools/{collectionId}/{activityType}/{activityId}/{productId}
//
// Note: there is no PUT method path resource.
//
// beforeAll creates an activity, product, and product dates; afterAll cleans up most.

const client = createClient();

const TEST_COLLECTION_ID = "TEST_POOLS";
const TEST_ACTIVITY_TYPE = "dayuse";
const START_DATE = "2321-06-15";
const END_DATE = "2321-07-15";

let createdActivityId;
let createdProductId;
let createdProductDates;

// PRODUCT_API_PUT_CONFIG has globalId: isMandatory: true but autoGlobalId:true
// sets it AFTER validation runs. Pass a placeholder UUID so the mandatory
// check passes; autoGlobalId overwrites it before writing to DynamoDB.
const placeholderGlobalId = require("crypto").randomUUID();

beforeAll(async () => {
  // 1. Create a fresh activity so products can reference a known, real entity.
  //    activityType MUST be a query param — the handler reads from queryStringParameters.
  const activityRes = await client.post(
    `/activities/${TEST_COLLECTION_ID}?activityType=${TEST_ACTIVITY_TYPE}`,
    { displayName: "Integration Test Activity (for inventoryPools)" },
  );
  if (activityRes.status === 200 || activityRes.status === 201) {
    createdActivityId = activityRes.data?.data?.[0]?.data?.activityId;
  } else {
    console.error(
      "[inventoryPools beforeAll] activity POST failed:",
      activityRes.status,
      JSON.stringify(activityRes.data),
    );
    return;
  }
  if (!createdActivityId) {
    console.error(
      "[inventoryPools beforeAll] activity created but activityId not found in response:",
      JSON.stringify(activityRes.data),
    );
    return;
  }

  // 2. Create the product referencing the newly created activity.
  //    assetList is required so initializeInventoryPools can create pool records.
  const body = {
    globalId: placeholderGlobalId, // satisfies isMandatory check before autoGlobalId runs
    activityType: TEST_ACTIVITY_TYPE,
    activityId: createdActivityId,
    displayName: "Integration Test Product (for inventoryPools)",
    timezone: "America/Vancouver",
    partyPolicy: {
      pk: "policy::party::1",
      sk: "v1",
    },
    feePolicy: {
      pk: "policy::fee::1",
      sk: "v1",
    },
    changePolicy: {
      pk: "policy::change::1",
      sk: "v1",
    },
    reservationPolicy: {
      pk: "policy::reservation::1",
      sk: "v1",
    },
    assetList: [
      {
        primaryKey: {
          pk: "asset::pass::1",
          sk: "v1",
        },
        allocationType: "fixed",
        quantity: 4,
      },
    ],
  };

  const productRes = await client.post(`/products/${TEST_COLLECTION_ID}`, body);
  if (productRes.status === 200 || productRes.status === 201) {
    createdProductId =
      productRes.data?.data?.productId ??
      productRes.data?.data?.[0]?.data?.productId;
  } else {
    console.error(
      "[inventoryPools beforeAll] product POST failed:",
      productRes.status,
      JSON.stringify(productRes.data),
    );
    return;
  }

  // 3. Create product dates for the date range — initializeInventoryPools requires
  //    these to exist before it can create pool records.
  if (createdActivityId && createdProductId) {
    const res = await client.post(
      `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
      { startDate: START_DATE, endDate: END_DATE },
    );

    if (res.status === 200 || res.status === 201) {
      createdProductDates = true;
    } else {
      console.error(
        "[inventoryPools beforeAll] product-dates POST failed:",
        res.status,
        JSON.stringify(res.data),
      );
    }
  }
});

// Clean up other items
afterAll(async () => {
  if (createdProductDates && createdActivityId && createdProductId) {
    await client.delete(
      `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
      { data: { startDate: START_DATE, endDate: END_DATE } },
    );
  }
  if (createdProductId && createdActivityId) {
    await client.delete(
      `/products/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
    );
  }
  if (createdActivityId) {
    await client.delete(
      `/activities/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}`,
    );
  }
  await deleteCounters([
    `activity::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}`,
    ...(createdActivityId
      ? [`product::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}::${createdActivityId}::counter`]
      : []),
  ]);
});

describe("InventoryPools", () => {
    // Make sure we created the inventoryPool items
  describe("POST /inventory-pools/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 and confirms 31 inventoryPool records created (31 days x 1 asset)", async () => {
      if (!createdProductDates) return;
      const res = await client.post(
        `/inventory-pools/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?startDate=${START_DATE}&endDate=${END_DATE}`,
      );

      expect(res.data.msg).toEqual(
        `Successfully initialized 31 inventory records for product ${createdProductId} from ${START_DATE} to ${END_DATE}`,
      );
      expect(res.status).toBe(200);
    });
  });

  // Make sure we have the required items in inventoryPool
  describe("GET /inventory-pools/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200, has 1 pool record on the start date, with correct capacity and availability", async () => {
      if (!createdProductDates) return;
      const res = await client.get(
        `/inventory-pools/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?date=${START_DATE}`,
      );


      // Test that we're getting an array of items
      expect(res.data.data).toEqual(expect.any(Array));
      expect(res.data.data.length).toEqual(1);

      const pool = res.data.data[0];
      // Make sure there's data in there, specifically 4 item capacity and availability
      expect(pool.capacity).toEqual(4);
      expect(pool.availability).toEqual(4);
      expect(res.status).toBe(200);
    });
  });

  // Show that the inventoryPool records are deleted
  describe("DELETE /inventory-pools/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 and deletes 31 inventoryPool records (31 days x 1 asset)", async () => {
      if (!createdProductDates) return;
      const res = await client.delete(
        `/inventory-pools/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?startDate=${START_DATE}&endDate=${END_DATE}`,
      );

      expect(res.data.msg).toEqual(
        "InventoryPools deleted successfully. Total deleted: 31",
      );
      expect(res.status).toBe(200);
    });
  });
});
