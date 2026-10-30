'use strict';

const { memoryDynamo } = require('../helpers/memoryDynamo');

let mockDb;
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (cmd) => mockDb.send(cmd) })),
}));

const { handler: publicGet } = require('../../src/handlers/config/GET/public');
const { handler: adminGet } = require('../../src/handlers/config/GET/admin');

const REF = 'reference-data';
const data = (res) => JSON.parse(res.body).data;

beforeEach(() => {
  mockDb = memoryDynamo();
  mockDb.put(REF, { pk: 'config', sk: 'public', PUBLIC_USER_POOL_ID: 'ca-central-1_pub' });
  mockDb.put(REF, { pk: 'config', sk: 'admin', ADMIN_USER_POOL_ID: 'ca-central-1_admin' });
});

describe('GET /config', () => {
  it('public returns the public config record only', async () => {
    const res = await publicGet({ httpMethod: 'GET' }, {});
    expect(res.statusCode).toBe(200);
    expect(data(res)).toEqual({ pk: 'config', sk: 'public', PUBLIC_USER_POOL_ID: 'ca-central-1_pub' });
  });

  it('admin returns the admin config record', async () => {
    expect(data(await adminGet({ httpMethod: 'GET' }, {}))).toEqual({ pk: 'config', sk: 'admin', ADMIN_USER_POOL_ID: 'ca-central-1_admin' });
  });

  it.each([publicGet, adminGet])('returns 400 when the read fails', async (h) => {
    mockDb.send = async () => { throw new Error('throttled'); };
    const res = await h({ httpMethod: 'GET' }, {});
    expect(res.statusCode).toBe(400);
    expect(data(res)).toEqual([]);
  });
});
