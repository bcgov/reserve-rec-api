const { createClient } = require('./helpers/client');

// Routes:
//   POST /search
//   GET  /search/permits

const client = createClient();

describe('Search', () => {
  // POST /search — uses `text` field for full-text search via OpenSearch.
  // Returns 400 if the OpenSearch cluster is not accessible in this environment.
  describe('POST /search', () => {
    it('returns 200 for a general text search', async () => {
      const body = { text: 'test' };
      const res = await client.post('/search', body);
      if (res.status !== 200) {
        console.error('[search POST text] failed:', res.status, JSON.stringify(res.data));
      }
      expect(res.status).toBe(200);
    });

    it('returns 200 for an empty search (returns all)', async () => {
      const res = await client.post('/search', {});
      if (res.status !== 200) {
        console.error('[search POST empty] failed:', res.status, JSON.stringify(res.data));
      }
      expect(res.status).toBe(200);
    });

    it('returns 200 for autocomplete/suggest request', async () => {
      const body = { text: 'park', suggest: true };
      const res = await client.post('/search', body);
      if (res.status !== 200) {
        console.error('[search POST suggest] failed:', res.status, JSON.stringify(res.data));
      }
      expect(res.status).toBe(200);
    });
  });
});
