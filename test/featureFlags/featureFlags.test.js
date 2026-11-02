'use strict';

const { memoryDynamo } = require('../helpers/memoryDynamo');

let mockDb;
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (cmd) => mockDb.send(cmd) })),
}));

const { handler: putHandler } = require('../../src/handlers/featureFlags/PUT/admin');
const { handler: adminGet } = require('../../src/handlers/featureFlags/GET/admin');
const { handler: publicGet } = require('../../src/handlers/featureFlags/GET/public');

const REF = 'reference-data';
const superadmin = { principalId: 'sub-boss', permissions: JSON.stringify({ superadmin: 'superadmin' }) };
const staff = { principalId: 'sub-staff', permissions: JSON.stringify({ bcparks_7: 'staff' }) };
const put = (body, authorizer = superadmin) => ({ httpMethod: 'PUT', body: JSON.stringify(body), requestContext: { authorizer } });
const data = (res) => JSON.parse(res.body).data;

beforeEach(() => {
  mockDb = memoryDynamo();
});

describe('PUT /feature-flags', () => {
  it('answers CORS preflight', async () => {
    expect((await putHandler({ httpMethod: 'OPTIONS' }, {})).statusCode).toBe(200);
  });

  it('stores the new flags and bumps the version', async () => {
    mockDb.put(REF, { pk: 'config', sk: 'featureFlags', flags: { enablePayments: true }, version: 4 });

    const res = await putHandler(put({ flags: { enablePayments: false, waitingRoom: true } }), {});

    expect(res.statusCode).toBe(200);
    expect(data(res)).toMatchObject({ flags: { enablePayments: false, waitingRoom: true }, version: 5 });
    expect(mockDb.get(REF, 'config', 'featureFlags')).toMatchObject({ flags: { enablePayments: false, waitingRoom: true }, version: 5 });
  });

  it('starts at version 1 when no flags record exists', async () => {
    const res = await putHandler(put({ flags: { enablePayments: true } }), {});
    expect(data(res).version).toBe(1);
  });

  it('refuses a non-superadmin', async () => {
    const res = await putHandler(put({ flags: { enablePayments: false } }, staff), {});
    expect(res.statusCode).toBe(403);
    expect(mockDb.get(REF, 'config', 'featureFlags')).toBeUndefined();
  });

  it.each([
    ['no flags', {}],
    ['a non-boolean flag', { flags: { enablePayments: 'yes' } }],
  ])('rejects a body with %s', async (_, body) => {
    const res = await putHandler(put(body), {});
    expect(res.statusCode).toBe(400);
    expect(mockDb.get(REF, 'config', 'featureFlags')).toBeUndefined();
  });
});

describe('GET /feature-flags', () => {
  const stored = { pk: 'config', sk: 'featureFlags', flags: { enablePayments: false }, metadata: { lastUpdated: '2026-10-01T00:00:00.000Z' }, version: 3 };

  it('public read returns only the flags', async () => {
    mockDb.put(REF, stored);
    expect(data(await publicGet({ httpMethod: 'GET' }, {}))).toEqual({ enablePayments: false });
  });

  it('public read with admin=true returns the full record', async () => {
    mockDb.put(REF, stored);
    expect(data(await publicGet({ httpMethod: 'GET', queryStringParameters: { admin: 'true' } }, {}))).toEqual({
      flags: { enablePayments: false }, metadata: { lastUpdated: '2026-10-01T00:00:00.000Z' }, version: 3,
    });
  });

  it('public read defaults to payments on when the record is missing or unreadable', async () => {
    expect(data(await publicGet({ httpMethod: 'GET' }, {}))).toEqual({ enablePayments: true });
    expect(data(await publicGet({ httpMethod: 'GET', queryStringParameters: { admin: 'true' } }, {}))).toEqual({ flags: { enablePayments: true }, metadata: null, version: 0 });
    mockDb.send = async () => { throw new Error('throttled'); };
    const res = await publicGet({ httpMethod: 'GET' }, {});
    expect(res.statusCode).toBe(200);
    expect(data(res)).toEqual({ enablePayments: true });
  });

  it('admin read returns the full record to a superadmin', async () => {
    mockDb.put(REF, stored);
    const res = await adminGet({ httpMethod: 'GET', requestContext: { authorizer: superadmin } }, {});
    expect(data(res)).toEqual({ flags: { enablePayments: false }, metadata: { lastUpdated: '2026-10-01T00:00:00.000Z' }, version: 3 });
  });

  it('admin read defaults when no record exists and refuses non-superadmins', async () => {
    expect(data(await adminGet({ httpMethod: 'GET', requestContext: { authorizer: superadmin } }, {}))).toEqual({ flags: { enablePayments: true }, metadata: null, version: 0 });
    expect((await adminGet({ httpMethod: 'GET', requestContext: { authorizer: staff } }, {})).statusCode).toBe(403);
  });

  it.each([publicGet, adminGet])('answers CORS preflight', async (h) => {
    expect((await h({ httpMethod: 'OPTIONS' }, {})).statusCode).toBe(200);
  });
});
