const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");

// Routes (routes with methods defined):
//   GET/POST/PUT  /products/{collectionId}
//   GET           /products/{collectionId}/{activityType}/{activityId}
//   PUT/DELETE    /products/{collectionId}/{activityType}/{activityId}/{productId}
//
// GET by collectionId requires activityType + activityId query params.
// GET by productId: pass productId as query param to the activityId route.
// Note: there is no GET method on the /{productId} path resource.
//
// beforeAll creates a product; afterAll deletes it.

const client = createClient();

const TEST_COLLECTION_ID = "TEST_PRODUCTS";
const TEST_ACTIVITY_TYPE = "dayuse";

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
    { displayName: "Integration Test Activity (for products)" },
  );
  if (activityRes.status === 200 || activityRes.status === 201) {
    createdActivityId = activityRes.data?.data?.[0]?.data?.activityId;
  } else {
    console.error(
      "[products beforeAll] activity POST failed:",
      activityRes.status,
      JSON.stringify(activityRes.data),
    );
    return;
  }

  if (!createdActivityId) {
    console.error(
      "[products beforeAll] activity created but activityId not found in response:",
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
  };
  const res = await client.post(`/products/${TEST_COLLECTION_ID}`, body);
  if (res.status === 200 || res.status === 201) {
    // Make sure that we created a product
    createdProductId =
      res.data?.data?.productId ?? res.data?.data?.[0]?.data?.productId;
  } else {
    console.error(
      "[products beforeAll] product POST failed:",
      res.status,
      JSON.stringify(res.data),
    );
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
  await deleteCounters([
    `activity::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}`,
    ...(createdActivityId
      ? [`product::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}::${createdActivityId}::counter`]
      : []),
  ]);
});

// Get all products for an activity
describe("Products", () => {
  // Make sure we created a product
  describe("POST /products/:collectionId (create)", () => {
    it("created a product in beforeAll and captured its ID", () => {
      expect(createdProductId).toBeDefined();
    });
  });

  // Update it
  describe("PUT /products/:collectionId/:activityType/:activityId/:productId", () => {
    it("updates the product and returns 200", async () => {
      if (!createdProductId || !createdActivityId) return;
      const res = await client.put(
        `/products/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
        { displayName: "Updated Integration Test Product" },
      );
      expect(res.status).toBe(200);
    });
  });

  // Get product by activityType and activityId with query params
  describe(`GET /products/${TEST_COLLECTION_ID}?activityType=...&activityId=...`, () => {
    it("returns 200 with required query params", async () => {
      if (!createdActivityId) return;
      const res = await client.get(
        `/products/${TEST_COLLECTION_ID}?activityType=${TEST_ACTIVITY_TYPE}&activityId=${createdActivityId}`,
      );
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get product by activityType and activityId with path params
  describe(`GET /products/:collectionId/:activityType/:activityId`, () => {
    it("returns 200", async () => {
      if (!createdActivityId) return;
      const res = await client.get(
        `/products/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}`,
      );
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get the product by productId
  describe("GET /products/:collectionId/:activityType/:activityId?productId=...", () => {
    it("returns 200 for the created product", async () => {
      if (!createdProductId || !createdActivityId) return;
      const res = await client.get(
        `/products/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}?productId=${createdProductId}`,
      );
      // Test that the PUT actually updated name
      expect(res.data.data.displayName).toEqual(
        "Updated Integration Test Product",
      );
      expect(res.status).toBe(200);
    });
  });

  describe("GET /relationships/{pk1}/{sk1}", () => {
    it("shows that there's a relationship between the activity and product", async () => {
      if (!createdProductId) return;
      pk = `activity::${TEST_COLLECTION_ID}`;
      sk = `${TEST_ACTIVITY_TYPE}::${createdActivityId}`;
      const res = await client.get(`/relationships/${pk}/${sk}`);
      
      expect(res.data.data.items.length).toEqual(1);

      // Should show something like pk: 'rel::activity::TEST_PRODUCTS::dayuse::10',
      expect(res.data.data.items[0].pk).toEqual(
        `rel::activity::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}::${createdActivityId}`,
      );
      // Should show something like sk: 'product::TEST_PRODUCTS::dayuse::10::1'
      expect(res.data.data.items[0].sk).toEqual(
        `product::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}::${createdActivityId}::${createdProductId}`,
      );

      expect(res.status).toBe(200);
    });
  });

  // Delete the product by the created IDs
  describe("DELETE /products/:collectionId/:activityType/:activityId/:productId", () => {
    it("returns 200 and confirms deletion of product", async () => {
      if (!createdProductId) return;
      const res = await client.delete(
        `/products/${TEST_COLLECTION_ID}/${TEST_ACTIVITY_TYPE}/${createdActivityId}/${createdProductId}`,
      );

      expect(res.data.msg).toEqual('Success');
      // Should show that the relationship with activity was also deleted
      expect(res.data.data.relationshipsDeleted).toEqual(1);
      expect(res.status).toBe(200);
    });
  });
});
