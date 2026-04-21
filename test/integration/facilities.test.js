const { createClient } = require("./helpers/client");
const { deleteCounters } = require("./helpers/dynamo-cleanup");


// Routes:
//   GET       /facilities/{collectionId}
//   GET/POST  /facilities/{collectionId}/{facilityType}
//   GET/PUT/DELETE /facilities/{collectionId}/{facilityType}/{facilityId}
//
// Note: POST auto-increments facilityId. beforeAll creates one resource;
//       afterAll cleans it up. Subsequent tests use captured IDs.

const client = createClient();

const TEST_COLLECTION_ID = "TEST_FACILITIES";
const TEST_FACILITY_TYPE = "naturalFeature";

let createdFacilityId;
let createdFacilityType;

// POST route is /facilities/{collectionId} — facilityType sent as query param.
beforeAll(async () => {
  const res = await client.post(
    `/facilities/${TEST_COLLECTION_ID}?facilityType=${TEST_FACILITY_TYPE}`,
    {
      displayName: "Integration Test Facility",
      timezone: "America/Vancouver",
      location: {
        type: "point",
        coordinates: [89.234, -89.234],
      },
      minMapZoom: 123,
      maxMapZoom: 456,
    },
  );
  if (res.status === 200 || res.status === 201) {
    createdFacilityId = res.data?.data?.[0]?.data?.facilityId;
    createdFacilityType =
      res.data?.data?.[0]?.data?.facilityType ?? TEST_FACILITY_TYPE;
  } else {
    console.error(
      "[facilities beforeAll] POST failed:",
      res.status,
      JSON.stringify(res.data),
    );
  }
});

// Clean up other items
afterAll(async () => {
  await deleteCounters([
    `facility::${TEST_COLLECTION_ID}::${TEST_FACILITY_TYPE}`
  ]);
});

describe("Facilities", () => {
  // Make sure we created a facility
  describe("POST /facilities/:collectionId/:facilityType (create)", () => {
    it("created a facility in beforeAll and captured its ID", () => {
      expect(createdFacilityId).toBeDefined();
    });
  });

  // Update it
  describe("PUT /facilities/:collectionId/:facilityType/:facilityId", () => {
    it("updates the facility and returns 200", async () => {
      if (!createdFacilityId) return;
      const res = await client.put(
        `/facilities/${TEST_COLLECTION_ID}/${createdFacilityType}/${createdFacilityId}`,
        { displayName: "Updated Integration Test Facility" },
      );
      expect(res.status).toBe(200);
    });
  });

  // Get facilities by collectionId
  describe(`GET /facilities/${TEST_COLLECTION_ID}`, () => {
    it("returns 200", async () => {
      const res = await client.get(`/facilities/${TEST_COLLECTION_ID}`);
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get facilities by Type
  describe(`GET /facilities/${TEST_COLLECTION_ID}/${TEST_FACILITY_TYPE}`, () => {
    it("returns 200", async () => {
      const res = await client.get(
        `/facilities/${TEST_COLLECTION_ID}/${TEST_FACILITY_TYPE}`,
      );
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      expect(res.status).toBe(200);
    });
  });

  // Get facility by collectionId
  describe("GET /facilities/:collectionId/:facilityType/:facilityId", () => {
    it("returns 200 for the created facility", async () => {
      if (!createdFacilityId) return;
      const res = await client.get(
        `/facilities/${TEST_COLLECTION_ID}/${createdFacilityType}/${createdFacilityId}`,
      );
      // Test that the PUT actually updated name
      expect(res.data.data.displayName).toEqual(
        "Updated Integration Test Facility",
      );
      expect(res.status).toBe(200);
    });
  });
  
  // Delete facility by collectionId
  describe("DELETE /facilities/:collectionId/:facilityType/:facilityId", () => {
    it("returns 200 for the created facility", async () => {
      if (!createdFacilityId) return;
      const res = await client.delete(
      `/facilities/${TEST_COLLECTION_ID}/${createdFacilityType}/${createdFacilityId}`,
    );

      expect(res.data.msg).toEqual('Success');
      expect(res.status).toBe(200);
    });
  });
});
