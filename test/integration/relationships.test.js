const { createClient } = require('./helpers/client');

// Routes:
//   POST /relationships
//   GET  /relationships/{pk1}/{sk1}/{pk2}/{sk2}
//   GET  /relationships/reverse/{pk2}/{sk2}

const client = createClient();

let resGeozoneCreated;
let resFacilityCreated;

const geozoneBody = {
  pk1: 'geozone::TEST_RELATIONSHIPS',
  sk1: '1',
  pk2: 'facility::TEST_RELATIONSHIPS',
  sk2: 'naturalFeature::1',
}

const facilityBody = {
  pk1: 'facility::TEST_RELATIONSHIPS',
  sk1: 'naturalFeature::1',
  pk2: 'activity::TEST_RELATIONSHIPS',
  sk2: 'dayuse::1',
}

// Create the relationships
beforeAll(async () => {
  const resGeozone = await client.post(
    `/relationships`,
    geozoneBody
  );
  if (resGeozone.status === 200 || resGeozone.status === 201) {
    resGeozoneCreated = resGeozone.data.data;
  } else {
    console.error(
      "[facilities beforeAll] POST failed:",
      resGeozone.status,
      JSON.stringify(resGeozone.data),
    );
  }

  const resFacility = await client.post(
    `/relationships`,
    facilityBody
  );
  if (resFacility.status === 200 || resFacility.status === 201) {
    resFacilityCreated = resFacility.data.data;
  } else {
    console.error(
      "[facilities beforeAll] POST failed:",
      resFacility.status,
      JSON.stringify(resFacility.data),
    );
  }
});

// Clean up
afterAll(async () => {
  if (resGeozoneCreated){
    const resGzDelete = await client.delete(
      `/relationships/${geozoneBody.pk1}/${geozoneBody.sk1}/${geozoneBody.pk2}/${geozoneBody.sk2}`,
    );
  }
  if (resFacilityCreated){
    const resFcDelete = await client.delete(
      `/relationships/${facilityBody.pk1}/${facilityBody.sk1}/${facilityBody.pk2}/${facilityBody.sk2}`,
    );
  }
});

// Post a geozone -> facility relationship
describe('Entity Relationships', () => {  
  // Make sure we can find the geozone -> facility relationship
  describe('GET /relationships/{pk1}/{sk1}', () => {
    it('retrieves relationships from a source and returns 200', async () => {
      const res = await client.get(
        `/relationships/${geozoneBody.pk1}/${geozoneBody.sk1}`,
      );
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      // Make sure the relationship has the right pk / sk
      expect(res.data.data.items[0].pk).toEqual(`rel::${geozoneBody.pk1}::${geozoneBody.sk1}`)
      expect(res.data.data.items[0].sk).toEqual(`${geozoneBody.pk2}::${geozoneBody.sk2}`)
      expect(res.status).toBe(200);
    });
  });
  
  // Make sure we can find the facility -> activity relationship
  describe('GET /relationships/{pk1}/{sk1}', () => {
    it('retrieves relationships from a source and returns 200', async () => {
      const res = await client.get(
        `/relationships/${facilityBody.pk1}/${facilityBody.sk1}`,
      );
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      // Make sure the relationship has the right pk / sk
      expect(res.data.data.items[0].pk).toEqual(`rel::${facilityBody.pk1}::${facilityBody.sk1}`)
      expect(res.data.data.items[0].sk).toEqual(`${facilityBody.pk2}::${facilityBody.sk2}`)
      expect(res.status).toBe(200);
    });
  });
  
  // Check that we can get relationship reverse look up (using GSI)
  // Will be the same as looking up relationship geozone -> facility
  describe('GET /relationships/reverse/{pk2}/{sk2}', () => {
    it('retrieves reverse relationships and returns 200', async () => {
      const res = await client.get(
         `/relationships/reverse/${geozoneBody.pk2}/${geozoneBody.sk2}`,
      );
      // Test that we're getting an array of items
      expect(res.data.data.items).toEqual(expect.any(Array));
      // Make sure there's data in there
      expect(res.data.data.items.length).toBeGreaterThan(0);
      // Make sure the relationship has the right pk / sk
      expect(res.data.data.items[0].pk).toEqual(`rel::${geozoneBody.pk1}::${geozoneBody.sk1}`)
      expect(res.data.data.items[0].sk).toEqual(`${geozoneBody.pk2}::${geozoneBody.sk2}`)
      expect(res.status).toBe(200);
    });
  });
});
