const { createClient } = require('./helpers/client');

// Routes:
//   POST          /policies/{policyType}
//   GET/PUT       /policies/{policyType}/{policyId}/{policyIdVersion}
//
// Policies are immutable — POST creates a new version, PUT creates a new version too.
// beforeAll creates a booking policy and captures policyId + policyIdVersion.

const client = createClient();

let createdPolicyId;
let createdPolicyVersion;

// TODO / NOTES

/** 
 * Policies are still in flux, so none of the endpoints here are useful right now
 * and are all being skipped. For example, there's a setup for 'booking', which is
 * deprecated and replaced with 'reservation' policy.
 * 
 * Also, there's no DELETE endpoint for policies, so there wouldn't be cleanup for
 * this either. The increment functionality will keep building policies, so we
 * wouldn't run into conflict, but we'd have many unused, useless policies.
 */

describe('Policies', () => {
  // Create a booking policy is created
  describe('POST /policies/:policyType (booking)', () => {
    it.skip('creates a booking policy and returns 200', async () => {
      const body = { displayName: 'Integration Test Booking Policy' };
      const res = await client.post('/policies/booking', body);
      if (![200, 201].includes(res.status)) {
        console.error('[policies booking POST] failed:', res.status, JSON.stringify(res.data));
      }
      expect([200, 201]).toContain(res.status);
      
    });
  });

  // Create a change policy is created
  describe('POST /policies/:policyType (change)', () => {
    it.skip('creates a change policy and returns 200', async () => {
      const body = { displayName: 'Integration Test Change Policy' };
      const res = await client.post('/policies/change', body);
      if (![200, 201].includes(res.status)) {
        console.error('[policies change POST] failed:', res.status, JSON.stringify(res.data));
      }
      expect([200, 201]).toContain(res.status);
    });
  });

  // Make sure the fee policy is created
  describe('POST /policies/:policyType (fee)', () => {
    it.skip('creates a fee policy and returns 200', async () => {
      const body = { displayName: 'Integration Test Fee Policy' };
      const res = await client.post('/policies/fee', body);
      if (![200, 201].includes(res.status)) {
        console.error('[policies fee POST] failed:', res.status, JSON.stringify(res.data));
      }
      expect([200, 201]).toContain(res.status);
    });
  });
  
  // Make sure the party policy is created
  describe('POST /policies/:policyType (party)', () => {
    it.skip('creates a party policy and returns 200', async () => {
      const body = { displayName: 'Integration Test Party Policy' };
      const res = await client.post('/policies/party', body);
      if (![200, 201].includes(res.status)) {
        console.error('[policies party POST] failed:', res.status, JSON.stringify(res.data));
      }
      expect([200, 201]).toContain(res.status);
    });
  });

  describe('GET /policies/:policyType/:policyId/:policyIdVersion', () => {
    it.skip('returns 200 for the created policy', async () => {
      if (!createdPolicyId) return;
      const res = await client.get(
        `/policies/booking/${createdPolicyId}/${createdPolicyVersion}`,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /policies/:policyType/:policyId', () => {
    it.skip('updates (new version) the policy and returns 200', async () => {
      if (!createdPolicyId) return;
      const res = await client.put(
        `/policies/booking/${createdPolicyId}/`,
        { description: 'Updated by integration test suite' },
      );
      expect(res.status).toBe(200);
    });
  });
});
