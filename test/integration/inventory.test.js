const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");

// Routes (routes with methods defined):
//   GET/POST/DELETE      /inventory/{collectionId}/{activityType}/{activityId}/{productId}/{date}
//
// Note: there is no PUT method path resource.
//
// beforeAll creates an activity and product. afterAll cleans up most.

const client = createClient();

const TEST_COLLECTION_ID = "TEST_INVENTORY";
const TEST_ACTIVITY_TYPE = "dayuse";
const START_DATE = "2123-04-15";
const END_DATE = "2123-05-15";

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
    { displayName: "Integration Test Activity (for inventory)" },
  );
  if (activityRes.status === 200 || activityRes.status === 201) {
    createdActivityId = activityRes.data?.data?.[0]?.data?.activityId;
  } else {
    console.error(
      "[inventory beforeAll] activity POST failed:",
      activityRes.status,
      JSON.stringify(activityRes.data),
    );
    return;
  }
  if (!createdActivityId) {
    console.error(
      "[inventory beforeAll] activity created but activityId not found in response:",
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
    // Make sure that we created a product
    createdProductId =
      productRes.data?.data?.productId ??
      productRes.data?.data?.[0]?.data?.productId;
  } else {
    console.error(
      "[inventory beforeAll] product POST failed:",
      productRes.status,
      JSON.stringify(productRes.data),
    );
  }

  // 3. Create the productDates referencing the newly created product
  //    {{base_url}}/product-dates/:collectionId/:activityType/:activityId/:productId
  if (createdActivityId && createdProductId) {
    const res = await client.post(
      `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
      { startDate: `${START_DATE}`, endDate: `${END_DATE}` },
    );

    if (res.status === 200 || (res.status === 201 && res.data.msg)) {
      // Just set to true to indicate creation succeeded
      createdProductDates = true;
    } else {
      console.error(
        "[inventory beforeAll] product POST failed:",
        res.status,
        JSON.stringify(res.data),
      );
    }
  }
});

// Clean up other items
afterAll(async () => {
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
  if (createdProductDates) {
    await client.delete(
      `/product-dates/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
      { data: { startDate: "2123-04-15", endDate: "2123-05-15" } },
    );
  }
  await deleteCounters([
    `activity::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}`,
    ...(createdActivityId
      ? [`product::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}::${createdActivityId}::counter`]
      : []),
  ]);
});

describe("Product Dates", () => {
  // Initiate the inventory with a POST request
  describe("POST /inventory/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200", async () => {
      if (!createdProductDates) return;
      const res = await client.post(
        `/inventory/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?startDate=${START_DATE}&endDate=${END_DATE}`,
      );

      // Test that we're getting an array of items
      // Make sure there's data in there, specifically there should be indication
      // that 124 (31 days X 4 passes) passes were made
      expect(res.data.msg).toEqual(
        `Successfully initialized 124 inventory records for product ${createdProductId} from ${START_DATE} to ${END_DATE}`,
      );
      expect(res.status).toBe(200);
    });
  });

  // Make a GET request for a specific day (the START_DATE)
  describe("GET /inventory/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 and has 4 passes on the day", async () => {
      if (!createdProductDates) return;
      const res = await client.get(
        `/inventory/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?date=${START_DATE}`,
      );

      // Test that we're getting an array of items
      expect(res.data.data).toEqual(expect.any(Array));
      // Make sure there's data in there, specifically there should be 4 (product's asset was quantity: 4)
      expect(res.data.data.length).toEqual(4);
      // The pass should be available
      expect(res.data.data[0].allocationStatus).toEqual("available");
      expect(res.status).toBe(200);
    });
  });
  
  // Delete the inventory
  describe("DELETE /inventory/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 and deletes 124 items (31 days x 4 passes each)", async () => {
      if (!createdProductDates) return;
      const res = await client.delete(
        `/inventory/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}?startDate=${START_DATE}&endDate=${END_DATE}`,
      );

      expect(res.data.msg).toEqual(
        "Inventory deleted successfully. Total deleted: 124",
      );
      expect(res.status).toBe(200);
    });
  });
});
