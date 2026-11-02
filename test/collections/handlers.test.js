'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  batchTransactData: jest.fn(),
}));

const { runQuery, getOne, batchTransactData } = require('/opt/dynamodb');
const { adminEvent, parse } = require('../helpers/adminEvent');
const { parseRequest } = require('../../src/handlers/collections/methods');
const GET_ADMIN = require('../../src/handlers/collections/GET/admin').handler;
const GET_PUBLIC = require('../../src/handlers/collections/GET/public').handler;
const POST = require('../../src/handlers/collections/POST/admin').handler;
const PUT = require('../../src/handlers/collections/PUT/admin').handler;
const DELETE = require('../../src/handlers/collections/DELETE/admin').handler;

const rows = () => [
  { collectionId: 'bcparks_1', displayName: 'One', adminNotes: 'n1' },
  { collectionId: 'bcparks_2', displayName: 'Two', adminNotes: 'n2' },
  { collectionId: 'bcparks_3', displayName: 'Three', adminNotes: 'n3' },
];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /collections (admin)', () => {
  it('gives a superadmin every collection with adminNotes, filtered by visibility', async () => {
    runQuery.mockResolvedValue({ items: rows() });
    const res = await GET_ADMIN(adminEvent({ queryStringParameters: { isVisible: 'false' } }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data.items).toEqual(rows());
    const [query] = runQuery.mock.calls[0];
    expect(query).toMatchObject({
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: '#isVisible = :isVisible',
      ExpressionAttributeNames: { '#isVisible': 'isVisible' },
      ExpressionAttributeValues: { ':pk': { S: 'collection' }, ':isVisible': { BOOL: false } },
    });
  });

  it('shows other callers only collections where they are staff, without adminNotes', async () => {
    runQuery.mockResolvedValue({ items: rows() });
    // A collection value of 'superadmin' is not a tier; only the superadmin key grants that.
    const res = await GET_ADMIN(adminEvent({ permissions: { bcparks_1: 'staff', bcparks_2: 'limited', bcparks_3: 'superadmin' } }));
    expect(parse(res).data.items).toEqual([
      { collectionId: 'bcparks_1', displayName: 'One' },
    ]);
  });

  it('fetches one collection and strips adminNotes for a non-superadmin', async () => {
    getOne.mockResolvedValue({ collectionId: 'bcparks_1', displayName: 'One', adminNotes: 'n1' });
    const res = await GET_ADMIN(adminEvent({ permissions: { bcparks_1: 'staff' }, pathParameters: { collectionId: 'bcparks_1' } }));
    expect(getOne).toHaveBeenCalledWith('collection', 'bcparks_1');
    expect(parse(res).data).toEqual({ collectionId: 'bcparks_1', displayName: 'One' });
  });

  it('404s an unknown collection', async () => {
    getOne.mockResolvedValue(undefined);
    const res = await GET_ADMIN(adminEvent({ pathParameters: { collectionId: 'nope' } }));
    expect(res.statusCode).toBe(404);
  });

  it('403s a caller with no role in the requested collection', async () => {
    const res = await GET_ADMIN(adminEvent({ permissions: { bcparks_2: 'staff' }, pathParameters: { collectionId: 'bcparks_1' } }));
    expect(res.statusCode).toBe(403);
    expect(getOne).not.toHaveBeenCalled();
  });

  it('turns a lookup failure into a 400', async () => {
    getOne.mockRejectedValue(new Error('throttled'));
    const res = await GET_ADMIN(adminEvent({ pathParameters: { collectionId: 'bcparks_1' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting collection');
  });

  it('answers a CORS preflight', async () => {
    expect((await GET_ADMIN({ httpMethod: 'OPTIONS' })).statusCode).toBe(200);
  });
});

describe('GET /collections (public)', () => {
  it('never returns adminNotes in a list', async () => {
    runQuery.mockResolvedValue({ items: rows() });
    const res = await GET_PUBLIC({ queryStringParameters: { isVisible: 'true' } });
    expect(res.statusCode).toBe(200);
    expect(parse(res).data.items.map((c) => c.adminNotes)).toEqual([undefined, undefined, undefined]);
    expect(runQuery.mock.calls[0][0].ExpressionAttributeValues[':isVisible']).toEqual({ BOOL: true });
  });

  it('never returns adminNotes for a single collection, and 404s a missing one', async () => {
    getOne.mockResolvedValueOnce({ collectionId: 'bcparks_1', adminNotes: 'n1' }).mockResolvedValueOnce(null);
    const one = await GET_PUBLIC({ pathParameters: { collectionId: 'bcparks_1' } });
    expect(parse(one).data).toEqual({ collectionId: 'bcparks_1' });
    const missing = await GET_PUBLIC({ pathParameters: { collectionId: 'nope' } });
    expect(missing.statusCode).toBe(404);
  });

  it('turns a query failure into a 400', async () => {
    runQuery.mockRejectedValue(new Error('throttled'));
    const res = await GET_PUBLIC({});
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting collections');
  });

  it('answers a CORS preflight', async () => {
    expect((await GET_PUBLIC({ httpMethod: 'OPTIONS' })).statusCode).toBe(200);
  });
});

const OPTIONAL = {
  description: 'Parks in the region',
  memberCollectionIds: ['bcparks_1', 'bcparks_2'],
  isVisible: true,
  imageUrls: ['https://example.test/a.jpg'],
  adminNotes: 'internal',
  searchTerms: ['coast'],
  timezone: 'America/Vancouver',
};

describe('POST /collections', () => {
  const body = () => ({ collectionId: 'bcparks_9', displayName: 'Nine', timezone: 'America/Vancouver', pk: 'x', version: 99 });

  it('creates the collection under pk "collection" with a guarded Put', async () => {
    getOne.mockResolvedValue(null);
    batchTransactData.mockResolvedValue({});

    const res = await POST(adminEvent({ httpMethod: 'POST', body: body() }));

    expect(res.statusCode).toBe(200);
    expect(getOne).toHaveBeenCalledWith('collection', 'bcparks_9');
    const [[put]] = batchTransactData.mock.calls[0];
    expect(put.data.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    expect(put.data.Item).toMatchObject({
      pk: { S: 'collection' }, sk: { S: 'bcparks_9' }, schema: { S: 'collection' }, version: { N: '1' },
    });
    expect(parse(res).data).toMatchObject({ pk: 'collection', sk: 'bcparks_9', displayName: 'Nine', version: 1 });
  });

  it('stores every optional field it accepts', async () => {
    getOne.mockResolvedValue(null);
    batchTransactData.mockResolvedValue({});
    const res = await POST(adminEvent({ httpMethod: 'POST', body: { collectionId: 'bcparks_9', displayName: 'Nine', ...OPTIONAL } }));
    expect(res.statusCode).toBe(200);
    const [[put]] = batchTransactData.mock.calls[0];
    expect(put.data.Item.memberCollectionIds).toEqual({ L: [{ S: 'bcparks_1' }, { S: 'bcparks_2' }] });
    expect(Object.keys(put.data.Item)).toEqual(expect.arrayContaining(Object.keys(OPTIONAL)));
  });

  it('409s when the collectionId is taken', async () => {
    getOne.mockResolvedValue({ collectionId: 'bcparks_9' });
    const res = await POST(adminEvent({ httpMethod: 'POST', body: body() }));
    expect(res.statusCode).toBe(409);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ['no collectionId', { displayName: 'Nine' }],
    ['no displayName', { collectionId: 'bcparks_9' }],
    ['a bad timezone', { collectionId: 'bcparks_9', displayName: 'Nine', timezone: 'UTC' }],
    ['a non-string member id', { collectionId: 'bcparks_9', displayName: 'Nine', memberCollectionIds: [1] }],
  ])('400s on %s without writing', async (_label, b) => {
    getOne.mockResolvedValue(null);
    const res = await POST(adminEvent({ httpMethod: 'POST', body: b }));
    expect(res.statusCode).toBe(400);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('403s a non-superadmin', async () => {
    const res = await POST(adminEvent({ httpMethod: 'POST', permissions: { bcparks_1: 'staff' }, body: body() }));
    expect(res.statusCode).toBe(403);
    expect(getOne).not.toHaveBeenCalled();
  });
});

describe('PUT /collections/{collectionId}', () => {
  it('updates an existing collection and ignores identity fields in the body', async () => {
    getOne.mockResolvedValue({ collectionId: 'bcparks_1' });
    batchTransactData.mockResolvedValue({});

    const res = await PUT(adminEvent({
      httpMethod: 'PUT',
      pathParameters: { collectionId: 'bcparks_1' },
      body: { collectionId: 'hijack', schema: 'x', pk: 'p', displayName: 'Renamed' },
    }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ displayName: 'Renamed' });
    const [[update]] = batchTransactData.mock.calls[0];
    expect(update.data.Key).toEqual({ pk: { S: 'collection' }, sk: { S: 'bcparks_1' } });
    expect(update.data.ConditionExpression).toBe('attribute_exists(pk)');
  });

  it('accepts every updatable field', async () => {
    getOne.mockResolvedValue({ collectionId: 'bcparks_1' });
    batchTransactData.mockResolvedValue({});
    const changes = { displayName: 'R', ...OPTIONAL };
    const res = await PUT(adminEvent({ httpMethod: 'PUT', pathParameters: { collectionId: 'bcparks_1' }, body: changes }));
    expect(res.statusCode).toBe(200);
    const [[update]] = batchTransactData.mock.calls[0];
    expect(Object.values(update.data.ExpressionAttributeNames).sort())
      .toEqual([...Object.keys(changes), 'lastUpdated', 'version'].sort());
  });

  it('404s an unknown collection', async () => {
    getOne.mockResolvedValue(null);
    const res = await PUT(adminEvent({ httpMethod: 'PUT', pathParameters: { collectionId: 'nope' }, body: { displayName: 'x' } }));
    expect(res.statusCode).toBe(404);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ['a field the update config forbids', { adminNotes: 'ok', rogue: true }],
    ['a non-boolean isVisible', { isVisible: 'yes' }],
    ['a null body', null],
  ])('400s on %s', async (_label, b) => {
    getOne.mockResolvedValue({ collectionId: 'bcparks_1' });
    const res = await PUT(adminEvent({ httpMethod: 'PUT', pathParameters: { collectionId: 'bcparks_1' }, body: b }));
    expect(res.statusCode).toBe(400);
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});

describe('DELETE /collections/{collectionId}', () => {
  it('deletes the collection row', async () => {
    getOne.mockResolvedValue({ collectionId: 'bcparks_1' });
    batchTransactData.mockResolvedValue({});
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', pathParameters: { collectionId: 'bcparks_1' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ collectionId: 'bcparks_1' });
    expect(batchTransactData).toHaveBeenCalledWith([{
      action: 'Delete',
      data: { TableName: 'reference-data', Key: { pk: { S: 'collection' }, sk: { S: 'bcparks_1' } } },
    }]);
  });

  it('404s an unknown collection', async () => {
    getOne.mockResolvedValue(null);
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', pathParameters: { collectionId: 'nope' } }));
    expect(res.statusCode).toBe(404);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s with a body', async () => {
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', pathParameters: { collectionId: 'bcparks_1' }, body: { a: 1 } }));
    expect(res.statusCode).toBe(400);
    expect(getOne).not.toHaveBeenCalled();
  });
});

describe('collections parseRequest', () => {
  it('rejects a request type other than POST or PUT, and a PUT without an id', async () => {
    await expect(parseRequest({}, 'PATCH')).rejects.toMatchObject({ code: 400, message: 'Unknown requestType: PATCH' });
    await expect(parseRequest({}, 'PUT')).rejects.toMatchObject({ code: 400 });
  });
});
