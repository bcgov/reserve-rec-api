const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");

// Routes (routes with methods defined):
//   GET/POST/DELETE      /products-dates/{collectionId}/{activityType}/{activityId}/{productId}
//
// Note: there is no PUT method path resource.
//
// beforeAll creates an activity and product. afterAll cleans up most.

const client = createClient();

const TEST_COLLECTION_ID = "TEST_PRODUCT_DATES";
const TEST_ACTIVITY_TYPE = "dayuse";
const STATE_DATE = "2123-04-15";
const END_DATE = "2123-05-15";

let createdActivityId;
let createdProductId;


// PRODUCT_API_PUT_CONFIG has globalId: isMandatory: true but autoGlobalId:true
// sets it AFTER validation runs. Pass a placeholder UUID so the mandatory
// check passes; autoGlobalId overwrites it before writing to DynamoDB.
const placeholderGlobalId = require("crypto").randomUUID();

beforeAll(async () => {
  // 1. Create a fresh activity so products can reference a known, real entity.
  //    activityType MUST be a query param — the handler reads from queryStringParameters.
  const activityRes = await client.post(
    `/activities/${TEST_COLLECTION_ID}?activityType=${TEST_ACTIVITY_TYPE}`,
    { displayName: "Integration Test Activity (for productDates)" },
  );
  if (activityRes.status === 200 || activityRes.status === 201) {
    createdActivityId = activityRes.data?.data?.[0]?.data?.activityId;
  } else {
    console.error(
      "[productDates beforeAll] activity POST failed:",
      activityRes.status,
      JSON.stringify(activityRes.data),
    );
    return;
  }
  if (!createdActivityId) {
    console.error(
      "[productDates beforeAll] activity created but activityId not found in response:",
      JSON.stringify(activityRes.data),
    );
    return;
  }

  // 2. Create the product referencing the newly created activity.
  const body = {
    globalId: placeholderGlobalId, // satisfies isMandatory check before autoGlobalId runs
    activityType: TEST_ACTIVITY_TYPE,
    activityId: createdActivityId,
    displayName: "Integration Test Product",
    timezone: "America/Vancouver",
    // TODO: Applying these policies, but we should look at having better
    // hardcoded policies once policies are fixed for a resilient future state
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
  };
  const productRes = await client.post(`/products/${TEST_COLLECTION_ID}`, body);
  if (productRes.status === 200 || productRes.status === 201) {
    // Make sure that we created a product
    createdProductId =
      productRes.data?.data?.productId ??
      productRes.data?.data?.[0]?.data?.productId;
  } else {
    console.error(
      "[productDates beforeAll] product POST failed:",
      productRes.status,
      JSON.stringify(productRes.data),
    );
  }
});

// Clean up other items
afterAll(async () => {
  if (createdProductId && createdActivityId) {
    if (!createdActivityId || !createdProductId) return;
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

describe("ProductDates", () => {
  // Make sure we created a productDates
  describe("POST /product-dates/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200", async () => {
      if (!createdProductId) return;
      const res = await client.post(
        `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
        { startDate: `${STATE_DATE}`, endDate: `${END_DATE}` },
      );

      expect(res.status).toBe(200);
    });
  });

  // Make sure we have the required items in the productDates
  describe("GET /product-dates/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 with required query params and confirms 31 items", async () => {
      if (!createdProductId) return;
      const res = await client.get(
        `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?startDate=${STATE_DATE}&endDate=${END_DATE}`,
      );

      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there, specifically there should be 31
      expect(res.data.data.items.length).toEqual(31);
      expect(res.status).toBe(200);
    });
  });

  // Show that the productDates are deleted
  describe("DELETE /product-dates/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 and confirms deletion of 31 productDate items", async () => {
      if (!createdProductId) return;
      const res = await client.delete(
        `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
        { data: { startDate: `${STATE_DATE}`, endDate: `${END_DATE}` } },
      );

      expect(res.data.msg).toEqual(
        "Product Dates deleted successfully. Total deleted: 31",
      );
      expect(res.status).toBe(200);
    });
  });
});
