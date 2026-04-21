const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");

// Routes:
//   GET/POST  /geozones/{collectionId}
//   GET/PUT/DELETE /geozones/{collectionId}/{geozoneId}
//
// Note: POST auto-increments geozoneId. beforeAll creates one resource;

const client = createClient();

const TEST_COLLECTION_ID = "TEST_GEOZONES";

const baseGeozone = {
  displayName: "Integration Test Geozone",
  description: "Test",
  isVisible: true,
  timezone: "America/Vancouver",
  minMapZoom: 123,
  maxMapZoom: 456,
  searchTerms: ["TEST"],
  location: {
    type: "point",
    coordinates: [89.234, -89.234],
  },
  envelope: {
    type: "envelope",
    coordinates: [
      [-89.123, 89.123],
      [-88.122, 88.122],
    ],
  },
};

let createdGeozoneId;

beforeAll(async () => {
  const res = await client.post(`/geozones/${TEST_COLLECTION_ID}`, baseGeozone);
  if (res.status === 200 || res.status === 201) {
    createdGeozoneId = res.data?.data?.[0]?.data?.geozoneId;
  } else {
    console.error(
      "[geozones beforeAll] POST failed:",
      res.status,
      JSON.stringify(res.data),
    );
  }
});

// Clean up other items
afterAll(async () => {
  await deleteCounters([
    `geozone::${TEST_COLLECTION_ID}`
  ]);
});

describe("Geozones", () => {
  // Make sure we create the geozone
  describe("POST /geozones/:collectionId (create)", () => {
    it("created a geozone in beforeAll and captured its ID", () => {
      expect(createdGeozoneId).toBeDefined();
    });
  });

  // Update it
  describe("PUT /geozones/:collectionId/:geozoneId", () => {
    it("updates the geozone and returns 200", async () => {
      if (!createdGeozoneId) return;
      const res = await client.put(
        `/geozones/${TEST_COLLECTION_ID}/${createdGeozoneId}`,
        { displayName: "Updated Integration Test Geozone" },
      );
      expect(res.status).toBe(200);
    });
  });

  // Get geozones by collectionId
  describe(`GET /geozones/${TEST_COLLECTION_ID}`, () => {
    it("returns 200 with a list", async () => {
      const res = await client.get(`/geozones/${TEST_COLLECTION_ID}`);
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get specific geozone by createdGeozoneId
  describe("GET /geozones/:collectionId/:geozoneId", () => {
    it("returns 200 for the created geozone", async () => {
      if (!createdGeozoneId) return;
      const res = await client.get(
        `/geozones/${TEST_COLLECTION_ID}/${createdGeozoneId}`,
      );
      // Test that the PUT actually updated name
      expect(res.data.data.items[0].displayName).toEqual(
        "Updated Integration Test Geozone",
      );
      expect(res.status).toBe(200);
    });
  });
  
  // Delete the geozone by createdGeozoneId
  describe("DETELE /geozones/:collectionId/:geozoneId", () => {
    it("returns 200 for the deleted geozone", async () => {
      if (!createdGeozoneId) return;
      const res = await client.delete(`/geozones/${TEST_COLLECTION_ID}/${createdGeozoneId}`);
      
      expect(res.data.msg).toEqual('Success');
      expect(res.status).toBe(200);
    });
  });
});
