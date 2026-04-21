const { createClient } = require('./helpers/client');

const client = createClient();

describe('GET /ping', () => {
  it('returns 200', async () => {
    const res = await client.get('/ping');
    expect(res.status).toBe(200);
  });
});
