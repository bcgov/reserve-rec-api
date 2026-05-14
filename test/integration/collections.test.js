const { createClient } = require("./helpers/client");

// Routes:
//   GET        /collections
//   POST       /collections        (collectionId supplied in body)
//   GET/PUT/DELETE /collections/{collectionId}
//
// Note: Collections use user-supplied IDs (no auto-increment counter).
// beforeAll creates one resource; afterAll cleans up if DELETE test didn't run.

const client = createClient();

const TEST_COLLECTION_ID = "TEST_COLLECTION";

const baseCollection = {
  collectionId: TEST_COLLECTION_ID,
  displayName: "Integration Test Collection",
  description: "Test",
  isVisible: true,
  searchTerms: ["TEST"],
};

let createdCollectionId;

beforeAll(async () => {
  const res = await client.post(`/collections`, baseCollection);
  if (res.status === 200 || res.status === 201) {
    createdCollectionId = res.data?.data?.collectionId;
  } else {
    console.error(
      "[collections beforeAll] POST failed:",
      res.status,
      JSON.stringify(res.data),
    );
  }
});

// Clean up if the DELETE test didn't run or failed
afterAll(async () => {
  if (createdCollectionId) {
    await client.delete(`/collections/${createdCollectionId}`).catch(() => {});
  }
});

describe.only("Collections", () => {
  // Make sure we created the collection
  describe("POST /collections (create)", () => {
    it("created a collection in beforeAll and captured its ID", () => {
      expect(createdCollectionId).toBeDefined();
    });
  });

  // Update it
  describe("PUT /collections/:collectionId", () => {
    it("updates the collection and returns 200", async () => {
      if (!createdCollectionId) return;
      const res = await client.put(
        `/collections/${createdCollectionId}`,
        { displayName: "Updated Integration Test Collection" },
      );
      expect(res.status).toBe(200);
    });
  });

  // Get all collections
  describe("GET /collections", () => {
    it("returns 200 with a list", async () => {
      const res = await client.get(`/collections`);
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get specific collection by createdCollectionId
  describe("GET /collections/:collectionId", () => {
    it("returns 200 for the created collection", async () => {
      if (!createdCollectionId) return;
      const res = await client.get(`/collections/${createdCollectionId}`);
      // Test that the PUT actually updated the name
      expect(res.data.data.displayName).toEqual(
        "Updated Integration Test Collection",
      );
      expect(res.status).toBe(200);
    });
  });

  // Delete the collection
  describe("DELETE /collections/:collectionId", () => {
    it("returns 200 for the deleted collection", async () => {
      if (!createdCollectionId) return;
      const res = await client.delete(`/collections/${createdCollectionId}`);
      expect(res.data.msg).toEqual("Collection deleted successfully");
      expect(res.status).toBe(200);
      createdCollectionId = null; // mark cleaned up so afterAll skips
    });
  });
});
