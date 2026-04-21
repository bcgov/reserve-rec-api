const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");

// Routes (only routes with methods defined):
//   GET/POST/PUT  /activities/{collectionId}
//   GET/PUT/DELETE /activities/{collectionId}/{activityType}/{activityId}
//
// Note: there is NO route at /activities/{collectionId}/{activityType} alone.
// POST auto-increments activityId. beforeAll creates one resource

const client = createClient();

const TEST_COLLECTION_ID = "TEST_ACTIVITIES";
const TEST_ACTIVITY_TYPE = "dayuse";

let createdActivityId;
let createdActivityType;

beforeAll(async () => {
  const res = await client.post(`/activities/${TEST_COLLECTION_ID}`, {
    displayName: "Integration Test Activity",
    description: "Created by integration test suite",
    isVisible: true,
    activityType: TEST_ACTIVITY_TYPE,
  });
  if (res.status === 200 || res.status === 201) {
    createdActivityId = res.data?.data?.[0]?.data?.activityId;
    createdActivityType =
      res.data?.data?.[0]?.data?.activityType ?? TEST_ACTIVITY_TYPE;
  }
});

// The DELETE test case below removes the activity entity, but incrementCounter()
// leaves behind a counter record that is never cleaned up by entity deletion.
// Removing it here lets the next run start from id=1 instead of accumulating
// orphaned counter records.
afterAll(async () => {
  await deleteCounters([
    `activity::${TEST_COLLECTION_ID}::${TEST_ACTIVITY_TYPE}`,
  ]);
});

describe("Activities", () => {
  // Make sure we created an activity
  describe("POST /activities/:collectionId (create)", () => {
    it("created an activity in beforeAll and captured its ID", () => {
      expect(createdActivityId).toBeDefined();
    });
  });

  // Update it
  describe("PUT /activities/:collectionId/:activityType/:activityId", () => {
    it("updates the activity and returns 200", async () => {
      if (!createdActivityId) return;
      const res = await client.put(
        `/activities/${TEST_COLLECTION_ID}/${createdActivityType}/${createdActivityId}`,
        { displayName: "Updated Integration Test Activity" },
      );
      expect(res.status).toBe(200);
    });
  });

  // Get activities by collectionId
  describe(`GET /activities/${TEST_COLLECTION_ID}`, () => {
    it("returns 200", async () => {
      const res = await client.get(`/activities/${TEST_COLLECTION_ID}`);
      // Make sure we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in the array
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get specific activity by ID
  describe("GET /activities/:collectionId/:activityType/:activityId", () => {
    it("returns 200 for the created activity", async () => {
      if (!createdActivityId) return;
      const res = await client.get(
        `/activities/${TEST_COLLECTION_ID}/${createdActivityType}/${createdActivityId}`,
      );
      // Test that the PUT actually updated name
      // Chech the displayName was updated (might have to check a few activities being created)
      const displayNameUpdate = [...res.data.data.items].some(
        (obj) => obj.displayName === "Updated Integration Test Activity",
      );
      expect(displayNameUpdate).toBe(true);
      expect(res.status).toBe(200);
    });
  });
  
  // DELETE specific activity by ID
  describe("DELETE /activities/:collectionId/:activityType/:activityId", () => {
    it("returns 200 for the created activity", async () => {
      if (!createdActivityId) return;
      const res = await client.delete(
        `/activities/${TEST_COLLECTION_ID}/${createdActivityType}/${createdActivityId}`,
      );
      
      expect(res.data.msg).toEqual('Success');
      expect(res.status).toBe(200);
    });
  });
});
