'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  incrementCounter: jest.fn(),
  batchTransactData: jest.fn(),
}));

const { runQuery, getOne, incrementCounter, batchTransactData } = require('/opt/dynamodb');
const { adminEvent, parse } = require('../helpers/adminEvent');
const GET = require('../../src/handlers/geozones/_collectionId/GET/admin').handler;
const POST = require('../../src/handlers/geozones/_collectionId/POST/admin').handler;
const PUT = require('../../src/handlers/geozones/_collectionId/PUT/admin').handler;
const DELETE = require('../../src/handlers/geozones/_collectionId/DELETE/admin').handler;

const NOT_DELETED = '(attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted)';

const OPTIONAL = {
  description: 'Lakeside park',
  facilities: [{ pk: 'facility::bcparks_1', sk: 'campground::1' }],
  activities: [{ pk: 'activity::bcparks_1', sk: 'dayuse::1' }],
  imageUrl: 'https://example.test/a.jpg',
  adminNotes: 'gate code 1234',
  searchTerms: ['lake', 'camping'],
  parkLink: 'https://bcparks.ca/golden-ears',
};

const validGeozone = () => ({
  displayName: 'Golden Ears',
  location: { type: 'point', coordinates: [-122.47, 49.35] },
  envelope: { type: 'envelope', coordinates: [[-122.6, 49.5], [-122.3, 49.2]] },
  timezone: 'America/Vancouver',
  isVisible: true,
  minMapZoom: 5,
  maxMapZoom: 12,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /geozones/{collectionId}', () => {
  it('lists the collection geozones without the counter row, applying filters and hiding deleted rows', async () => {
    runQuery.mockResolvedValue({ items: [{ sk: 'counter' }, { sk: '1', adminNotes: 'n' }, { sk: '2' }] });

    const res = await GET(adminEvent({
      pathParameters: { collectionId: 'bcparks_1' },
      queryStringParameters: { isVisible: 'true', facilities: 'facility::bcparks_1::campground::1' },
    }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data.items).toEqual([{ sk: '1', adminNotes: 'n' }, { sk: '2' }]);
    const [query] = runQuery.mock.calls[0];
    expect(query.KeyConditionExpression).toBe('pk = :pk');
    expect(query.FilterExpression).toBe(`(#isVisible = :isVisible AND contains(#facilities, :facilities)) AND ${NOT_DELETED}`);
    expect(query.ExpressionAttributeValues).toEqual({
      ':pk': { S: 'geozone::bcparks_1' },
      ':isVisible': { BOOL: true },
      ':facilities': { S: 'facility::bcparks_1::campground::1' },
      ':notDeleted': { BOOL: false },
    });
  });

  it('queries one geozone by sk prefix when geozoneId is given', async () => {
    runQuery.mockResolvedValue({ items: [{ sk: '3' }] });
    const res = await GET(adminEvent({ pathParameters: { collectionId: 'bcparks_1', geozoneId: '3' } }));
    expect(res.statusCode).toBe(200);
    const [query] = runQuery.mock.calls[0];
    expect(query.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :sk)');
    expect(query.ExpressionAttributeValues[':sk']).toEqual({ S: '3' });
    expect(query.FilterExpression).toBe(NOT_DELETED);
  });

  it('403s a caller with no role in the collection', async () => {
    const res = await GET(adminEvent({ permissions: { bcparks_2: 'staff' }, pathParameters: { collectionId: 'bcparks_1' } }));
    expect(res.statusCode).toBe(403);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('400s without a collectionId', async () => {
    const res = await GET(adminEvent({ pathParameters: {} }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('collectionId is required');
  });

  it('turns a query failure into a 400', async () => {
    runQuery.mockRejectedValue(new Error('throttled'));
    const res = await GET(adminEvent({ pathParameters: { collectionId: 'bcparks_1', geozoneId: '3' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting geozones');
  });

  it('answers a CORS preflight without touching the table', async () => {
    const res = await GET({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe('POST /geozones/{collectionId}', () => {
  it('assigns the next counter id and writes a guarded Put', async () => {
    incrementCounter.mockResolvedValue(7);
    batchTransactData.mockResolvedValue({});

    const res = await POST(adminEvent({ httpMethod: 'POST', pathParameters: { collectionId: 'bcparks_1' }, body: validGeozone() }));

    expect(res.statusCode).toBe(200);
    expect(incrementCounter).toHaveBeenCalledWith('geozone::bcparks_1');
    const [[put]] = batchTransactData.mock.calls[0];
    expect(put.action).toBe('Put');
    expect(put.data.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    expect(put.data.Item).toMatchObject({
      pk: { S: 'geozone::bcparks_1' },
      sk: { S: '7' },
      geozoneId: { N: '7' },
      identifier: { N: '7' },
      collectionId: { S: 'bcparks_1' },
      schema: { S: 'geozone' },
      version: { N: '1' },
    });
    expect(parse(res).data[0].key).toEqual({ pk: 'geozone::bcparks_1', sk: '7' });
  });

  it('stores every optional field it accepts', async () => {
    incrementCounter.mockResolvedValue(7);
    batchTransactData.mockResolvedValue({});
    const res = await POST(adminEvent({ httpMethod: 'POST', pathParameters: { collectionId: 'bcparks_1' }, body: { ...validGeozone(), ...OPTIONAL } }));
    expect(res.statusCode).toBe(200);
    const [[put]] = batchTransactData.mock.calls[0];
    expect(put.data.Item.searchTerms).toEqual({ L: [{ S: 'lake' }, { S: 'camping' }] });
    expect(put.data.Item.facilities).toEqual({ L: [{ M: { pk: { S: 'facility::bcparks_1' }, sk: { S: 'campground::1' } } }] });
    expect(Object.keys(put.data.Item)).toEqual(expect.arrayContaining(Object.keys(OPTIONAL)));
  });

  it('takes a fresh id and retries when the write conflicts', async () => {
    incrementCounter.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    batchTransactData.mockRejectedValueOnce(new Error('ConditionalCheckFailed')).mockResolvedValueOnce({});

    const res = await POST(adminEvent({ httpMethod: 'POST', pathParameters: { collectionId: 'bcparks_1' }, body: validGeozone() }));

    expect(res.statusCode).toBe(200);
    expect(batchTransactData).toHaveBeenCalledTimes(2);
    expect(parse(res).data[0].key.sk).toBe('8');
  });

  it('gives up after three failed writes', async () => {
    incrementCounter.mockResolvedValue(7);
    batchTransactData.mockRejectedValue(Object.assign(new Error('conflict'), { code: 409 }));
    const res = await POST(adminEvent({ httpMethod: 'POST', pathParameters: { collectionId: 'bcparks_1' }, body: validGeozone() }));
    expect(res.statusCode).toBe(409);
    expect(batchTransactData).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a timezone outside BC', { timezone: 'Europe/Paris' }, "Validation failed for field 'timezone'"],
    ['a missing displayName', { displayName: undefined }, "Mandatory field 'displayName' is missing in the request"],
    ['an unknown field', { rogue: 1 }, 'Invalid field.'],
    ['a facility reference with extra keys', { facilities: [{ pk: 'a', sk: 'b', name: 'x' }] }, "Validation failed for field 'facilities'"],
    ['a numeric search term', { searchTerms: [5] }, "Validation failed for field 'searchTerms'"],
  ])('400s on %s without writing', async (_label, patch, msg) => {
    incrementCounter.mockResolvedValue(7);
    const res = await POST(adminEvent({ httpMethod: 'POST', pathParameters: { collectionId: 'bcparks_1' }, body: { ...validGeozone(), ...patch } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(msg);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('403s a staff caller', async () => {
    const res = await POST(adminEvent({ permissions: { bcparks_1: 'staff' }, pathParameters: { collectionId: 'bcparks_1' }, body: validGeozone() }));
    expect(res.statusCode).toBe(403);
    expect(incrementCounter).not.toHaveBeenCalled();
  });
});

describe('PUT /geozones/{collectionId}', () => {
  it('updates the path geozone, ignoring key fields in the body', async () => {
    batchTransactData.mockResolvedValue({});
    const res = await PUT(adminEvent({
      httpMethod: 'PUT',
      pathParameters: { collectionId: 'bcparks_1', geozoneId: '3' },
      body: { pk: 'x', sk: 'y', geozoneId: 9, displayName: 'Renamed' },
    }));

    expect(res.statusCode).toBe(200);
    const [[update]] = batchTransactData.mock.calls[0];
    expect(update.data.Key).toEqual({ pk: { S: 'geozone::bcparks_1' }, sk: { S: '3' } });
    expect(update.data.ExpressionAttributeNames).toEqual({
      '#displayName': 'displayName', '#lastUpdated': 'lastUpdated', '#version': 'version',
    });
    expect(update.data.ExpressionAttributeValues[':displayName']).toEqual({ S: 'Renamed' });
  });

  it('accepts every updatable field', async () => {
    batchTransactData.mockResolvedValue({});
    const { location, envelope, timezone, isVisible, minMapZoom, maxMapZoom } = validGeozone();
    const changes = { displayName: 'R', schema: 'geozone', identifier: 3, location, envelope, timezone, isVisible, minMapZoom, maxMapZoom, ...OPTIONAL };
    const res = await PUT(adminEvent({ httpMethod: 'PUT', pathParameters: { collectionId: 'bcparks_1', geozoneId: '3' }, body: changes }));
    expect(res.statusCode).toBe(200);
    const [[update]] = batchTransactData.mock.calls[0];
    expect(Object.values(update.data.ExpressionAttributeNames).sort())
      .toEqual([...Object.keys(changes), 'lastUpdated', 'version'].sort());
  });

  it('bulk-updates using each item geozoneId', async () => {
    batchTransactData.mockResolvedValue({});
    const res = await PUT(adminEvent({
      httpMethod: 'PUT',
      pathParameters: { collectionId: 'bcparks_1' },
      body: [{ geozoneId: '1', isVisible: false }, { geozoneId: '2', isVisible: true }],
    }));
    expect(res.statusCode).toBe(200);
    expect(batchTransactData.mock.calls[0][0].map((u) => u.data.Key.sk.S)).toEqual(['1', '2']);
  });

  it.each([
    ['no geozoneId anywhere', { displayName: 'x' }],
    ['a field the update config forbids', { geozoneId: '1', collectionId: 'other' }],
    ['a wrong-typed value', { geozoneId: '1', minMapZoom: 'far' }],
    ['a schema other than geozone', { geozoneId: '1', schema: 'facility' }],
    ['a malformed envelope', { geozoneId: '1', envelope: { type: 'envelope', coordinates: [[-122.3, 49.5], [-122.6, 49.2]] } }],
  ])('400s on %s without writing', async (_label, body) => {
    const res = await PUT(adminEvent({ httpMethod: 'PUT', pathParameters: { collectionId: 'bcparks_1' }, body }));
    expect(res.statusCode).toBe(400);
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});

describe('DELETE /geozones/{collectionId}/{geozoneId}', () => {
  const path = { collectionId: 'bcparks_1', geozoneId: '3' };

  it('removes its relationships, then soft-deletes the geozone as the caller', async () => {
    getOne.mockResolvedValue({ pk: 'geozone::bcparks_1', sk: '3' });
    runQuery
      .mockResolvedValueOnce({ items: [{ pk: 'rel::geozone::bcparks_1::3', sk: 'facility::bcparks_1::campground::1' }] })
      .mockResolvedValueOnce({ items: [] });
    batchTransactData.mockResolvedValue({});

    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', pathParameters: path, principalId: 'admin-7' }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data.relationshipsDeleted).toBe(1);
    expect(getOne).toHaveBeenCalledWith('geozone::bcparks_1', '3');
    expect(batchTransactData).toHaveBeenCalledTimes(2);
    expect(batchTransactData.mock.calls[0][0][0].action).toBe('Delete');
    const [[softDelete]] = batchTransactData.mock.calls[1];
    expect(softDelete.action).toBe('Update');
    expect(softDelete.data.Key).toEqual({ pk: { S: 'geozone::bcparks_1' }, sk: { S: '3' } });
    expect(softDelete.data.UpdateExpression).toBe('SET isDeleted = :true, deletedAt = :deletedAt, deletedBy = :deletedBy');
    expect(softDelete.data.ExpressionAttributeValues[':true']).toEqual({ BOOL: true });
    expect(softDelete.data.ExpressionAttributeValues[':deletedBy']).toEqual({ S: 'admin-7' });
  });

  it('404s an unknown geozone without deleting anything', async () => {
    getOne.mockResolvedValue(null);
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', pathParameters: path }));
    expect(res.statusCode).toBe(404);
    expect(runQuery).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ['a body', { pathParameters: path, body: { a: 1 } }],
    ['no geozoneId', { pathParameters: { collectionId: 'bcparks_1' } }],
  ])('400s with %s', async (_label, opts) => {
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', ...opts }));
    expect(res.statusCode).toBe(400);
    expect(getOne).not.toHaveBeenCalled();
  });
});
