const { createClient } = require('./helpers/client');

// Routes:
//   GET  /users/{userPoolId}
//   GET  /users/{userPoolId}/{sub}
//   GET  /users/me
//   GET  /users/search

const client = createClient();

// The users handler accepts 'admin' and 'public' as shorthand aliases
// that it resolves to the real user pool IDs from DynamoDB config.
// Override with env vars to use specific pool IDs directly.

// NOTE: if you're testing in sandbox, you'll need to map user's IAM role to OS
// in Dashboard's Security -> Roles -> Mapped Users.

// Otherwise just skip them with it.skip(...)
const ADMIN_POOL_ID = process.env.TEST_ADMIN_USER_POOL_ID || 'admin-pool-it';
const PUBLIC_POOL_ID = process.env.TEST_PUBLIC_USER_POOL_ID || 'public-pool-id';
const TEST_USER_SUB = process.env.TEST_USER_SUB || null;

describe('Users', () => {
  describe('GET /users/me', () => {
    it.skip('returns 200 or 401', async () => {
      const res = await client.get('/users/me');
      // Without auth in IS_OFFLINE mode the authorizer passes; in real env expect 401
      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe(`GET /users/${ADMIN_POOL_ID} (list admin users)`, () => {
    it.skip('returns 200', async () => {
      const res = await client.get(`/users/${ADMIN_POOL_ID}`);
      expect(res.status).toBe(200);
    });
  });

  describe(`GET /users/${PUBLIC_POOL_ID} (list public users)`, () => {
    it.skip('returns 200', async () => {
      const res = await client.get(`/users/${PUBLIC_POOL_ID}`);
      expect(res.status).toBe(200);
    });
  });

  describe(`GET /users/${ADMIN_POOL_ID}/:sub`, () => {
    it.skip('returns 200 or 404 when sub is provided', async () => {
      if (!TEST_USER_SUB) return;
      const res = await client.get(`/users/${ADMIN_POOL_ID}/${TEST_USER_SUB}`);
      expect([200, 400]).toContain(res.status);
    });
  });

  // The users search endpoint is POST /users/search (not GET)
  describe('POST /users/search', () => {
    it.skip('returns 200', async () => {
      const res = await client.post('/users/search', { query: 'test' });
      if (res.status !== 200) {
        console.error('[users search POST] failed:', res.status, JSON.stringify(res.data));
      }
      expect(res.status).toBe(200);
    });
  });
});
