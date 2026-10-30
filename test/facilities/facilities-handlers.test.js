'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
  incrementCounter: jest.fn(),
  batchTransactData: jest.fn(),
}));
jest.mock('../../src/common/relationship-utils', () => ({
  getRelationshipsByGsipk: jest.fn(),
  deleteEntityRelationships: jest.fn(),
}));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOne, runQuery, batchGetData, incrementCounter, batchTransactData } = require('/opt/dynamodb');
const { getRelationshipsByGsipk, deleteEntityRelationships } = require('../../src/common/relationship-utils');
const { handler: adminGet } = require('../../src/handlers/facilities/_collectionId/GET/admin');
const { handler: publicGet } = require('../../src/handlers/facilities/_collectionId/GET/public');
const { handler: postHandler } = require('../../src/handlers/facilities/_collectionId/POST/admin');
const { handler: putHandler } = require('../../src/handlers/facilities/_collectionId/PUT/admin');
const { handler: deleteHandler } = require('../../src/handlers/facilities/_collectionId/DELETE/admin');

const COL = 'bcparks_1';
const STAFF = { [COL]: 'staff' };
const SUPERADMIN = { superadmin: 'superadmin' };
const VISIBLE_CLAUSE = '(attribute_not_exists(#isVisible) OR #isVisible = :visible)';
const NOT_DELETED = '(attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted)';

const event = ({ permissions = STAFF, sub = 'user-1', body, pathParameters = {}, queryStringParameters } = {}) => ({
  requestContext: { authorizer: { principalId: sub, permissions: JSON.stringify(permissions) } },
  pathParameters: { collectionId: COL, ...pathParameters },
  queryStringParameters,
  body: body === undefined ? null : JSON.stringify(body),
});
const parse = (res) => JSON.parse(res.body);
const firstWrite = () => batchTransactData.mock.calls[0][0][0];
const lastQuery = () => runQuery.mock.calls[runQuery.mock.calls.length - 1][0];

const STORED = {
  displayName: 'Lot A', adminNotes: 'gate code', creationDate: '2026-01-01', lastUpdated: '2026-02-01', version: 3,
};
const NEW_LOT = {
  displayName: 'Lot B',
  location: { type: 'point', coordinates: [-122.9, 50.3] },
  timezone: 'America/Vancouver',
  minMapZoom: 10,
  maxMapZoom: 18,
};

beforeEach(() => {
  jest.clearAllMocks();
  batchTransactData.mockResolvedValue({});
  incrementCounter.mockResolvedValue(2);
  runQuery.mockResolvedValue({ items: [] });
});

describe('GET /facilities/{collectionId}/{facilityType}/{facilityId}', () => {
  const single = { facilityType: 'structure', facilityId: '1' };

  it('strips admin and audit fields for public callers', async () => {
    getOne.mockResolvedValue({ ...STORED });
    const res = await publicGet(event({ pathParameters: single }));
    expect(getOne).toHaveBeenCalledWith(`facility::${COL}`, 'structure::1');
    expect(parse(res).data).toEqual({ displayName: 'Lot A' });
  });

  it('strips only adminNotes for staff', async () => {
    getOne.mockResolvedValue({ ...STORED });
    const res = await adminGet(event({ pathParameters: single }));
    expect(parse(res).data).toEqual({ displayName: 'Lot A', creationDate: '2026-01-01', lastUpdated: '2026-02-01', version: 3 });
  });

  it('returns everything to superadmins', async () => {
    getOne.mockResolvedValue({ ...STORED });
    const res = await adminGet(event({ permissions: SUPERADMIN, pathParameters: single }));
    expect(parse(res).data).toEqual(STORED);
  });

  it('treats a soft-deleted facility as not found', async () => {
    getOne.mockResolvedValue({ ...STORED, isDeleted: true });
    const res = await adminGet(event({ permissions: SUPERADMIN, pathParameters: single }));
    expect(parse(res).data).toBeNull();
  });

  it('attaches related activities when fetchActivities is set', async () => {
    getOne.mockResolvedValue({ displayName: 'Lot A' });
    runQuery.mockResolvedValue({ items: [{ pk2: `activity::${COL}`, sk2: 'dayuse::4' }] });
    batchGetData.mockResolvedValue([{ displayName: 'Day pass' }]);

    const res = await adminGet(event({ permissions: SUPERADMIN, pathParameters: single, queryStringParameters: { fetchActivities: 'true' } }));

    expect(lastQuery().ExpressionAttributeValues).toEqual({
      ':pk': { S: `rel::facility::${COL}::structure::1` }, ':sk': { S: 'activity::' },
    });
    expect(batchGetData).toHaveBeenCalledWith([{ pk: `activity::${COL}`, sk: 'dayuse::4' }], expect.any(String));
    expect(parse(res).data.activities).toEqual([{ displayName: 'Day pass' }]);
  });

  it('attaches related geozones when fetchGeozones is set', async () => {
    getOne.mockResolvedValue({ displayName: 'Lot A' });
    getRelationshipsByGsipk.mockResolvedValue({ items: [{ pk1: `geozone::${COL}`, sk1: '7' }] });
    batchGetData.mockResolvedValue([{ displayName: 'North zone' }]);

    const res = await adminGet(event({ permissions: SUPERADMIN, pathParameters: single, queryStringParameters: { fetchGeozones: 'true' } }));

    expect(getRelationshipsByGsipk).toHaveBeenCalledWith(`rel::facility::${COL}::structure::1`, 'geozone');
    expect(batchGetData).toHaveBeenCalledWith([{ pk: `geozone::${COL}`, sk: '7' }], expect.any(String));
    expect(parse(res).data.geozones).toEqual([{ displayName: 'North zone' }]);
  });

  it('returns empty related lists when nothing is linked', async () => {
    getOne.mockResolvedValue({ displayName: 'Lot A' });
    getRelationshipsByGsipk.mockResolvedValue({ items: [] });
    const res = await adminGet(event({
      permissions: SUPERADMIN, pathParameters: single, queryStringParameters: { fetchActivities: 'true', fetchGeozones: 'true' },
    }));
    expect(parse(res).data).toEqual({ displayName: 'Lot A', activities: [], geozones: [] });
    expect(batchGetData).not.toHaveBeenCalled();
  });

  it('400s when reading the facility fails', async () => {
    getOne.mockRejectedValue(new Error('down'));
    const res = await publicGet(event({ pathParameters: single }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting facility');
  });
});

describe('GET /facilities/{collectionId} lists', () => {
  it('hides drafts from public callers', async () => {
    await publicGet(event({ queryStringParameters: { showOnMap: 'true' } }));
    const query = lastQuery();
    expect(query.KeyConditionExpression).toBe('pk = :pk');
    expect(query.FilterExpression).toBe(`(#showOnMap = :showOnMap) AND ${NOT_DELETED} AND ${VISIBLE_CLAUSE}`);
    expect(query.ExpressionAttributeValues).toMatchObject({ ':pk': { S: `facility::${COL}` }, ':showOnMap': { BOOL: true } });
  });

  it('shows drafts to staff, filtered by type', async () => {
    await adminGet(event({ pathParameters: { facilityType: 'campground' }, queryStringParameters: { isVisible: 'false' } }));
    const query = lastQuery();
    expect(query.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :sk)');
    expect(query.ExpressionAttributeValues).toMatchObject({ ':sk': { S: 'campground::' }, ':isVisible': { BOOL: false } });
    expect(query.FilterExpression).toBe(`(#isVisible = :isVisible) AND ${NOT_DELETED}`);
  });

  it('hides drafts of a type from public callers', async () => {
    await publicGet(event({ queryStringParameters: { facilityType: 'trail' } }));
    expect(lastQuery().FilterExpression).toBe(`${NOT_DELETED} AND ${VISIBLE_CLAUSE}`);
  });

  it.each([
    ['collection', {}],
    ['type', { facilityType: 'trail' }],
  ])('400s when the %s query fails', async (_label, pathParameters) => {
    runQuery.mockRejectedValue(new Error('down'));
    const res = await adminGet(event({ pathParameters }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting facilities');
  });

  it('400s without a collectionId', async () => {
    const res = await publicGet({ pathParameters: {} });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Facility Collection ID (collectionId) is required');
  });

  it.each([[adminGet], [publicGet]])('answers a CORS preflight', async (h) => {
    const res = await h({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('401s an admin read with malformed permissions', async () => {
    const res = await adminGet({ pathParameters: { collectionId: COL }, requestContext: { authorizer: { permissions: '{bad' } } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /facilities/{collectionId}/{facilityType}', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
  });
  afterEach(() => {
    global.setTimeout.mockRestore();
  });

  it('creates the facility under the next id, shown on the map by default', async () => {
    const res = await postHandler(event({ pathParameters: { facilityType: 'structure' }, body: NEW_LOT }));

    expect(res.statusCode).toBe(200);
    expect(incrementCounter).toHaveBeenCalledWith(`facility::${COL}`, ['structure']);
    const op = firstWrite();
    expect(op.data.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    expect(unmarshall(op.data.Item)).toMatchObject({
      ...NEW_LOT, pk: `facility::${COL}`, sk: 'structure::2', collectionId: COL, schema: 'facility',
      facilityType: 'structure', facilityId: 2, identifier: 2, showOnMap: true, version: 1,
    });
    expect(parse(res).data[0].key).toEqual({ pk: `facility::${COL}`, sk: 'structure::2' });
  });

  it('keeps an explicit showOnMap false and every optional field', async () => {
    const body = {
      ...NEW_LOT, showOnMap: false, description: 'd', facilitySubType: 'parkingLot', address: '1 Main St',
      isVisible: true, isOpen: false, closureStatus: 'Full closure', closureReason: 'Flooding', passesRequired: true,
      imageUrl: 'https://img', agreements: 'a', adminNotes: 'n', searchTerms: ['lot'],
    };
    const res = await postHandler(event({ queryStringParameters: { facilityType: 'structure' }, body }));
    expect(res.statusCode).toBe(200);
    expect(unmarshall(firstWrite().data.Item)).toMatchObject(body);
  });

  it('409s when the park already has a facility with that name', async () => {
    runQuery.mockResolvedValue({ items: [{ displayName: 'lot b', sk: 'structure::1' }] });
    const res = await postHandler(event({ pathParameters: { facilityType: 'structure' }, body: NEW_LOT }));
    expect(res.statusCode).toBe(409);
    expect(incrementCounter).not.toHaveBeenCalled();
  });

  it('retries with a fresh id when the write fails once', async () => {
    incrementCounter.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    batchTransactData.mockRejectedValueOnce(new Error('conflict')).mockResolvedValueOnce({});
    const res = await postHandler(event({ pathParameters: { facilityType: 'structure' }, body: NEW_LOT }));
    expect(res.statusCode).toBe(200);
    expect(unmarshall(batchTransactData.mock.calls[1][0][0].data.Item).sk).toBe('structure::3');
  });

  it('returns the write error once retries run out', async () => {
    batchTransactData.mockRejectedValue(Object.assign(new Error('still conflicting'), { code: 409 }));
    const res = await postHandler(event({ pathParameters: { facilityType: 'structure' }, body: NEW_LOT }));
    expect(res.statusCode).toBe(409);
    expect(parse(res).msg).toBe('still conflicting');
  });

  it.each([
    ['no facilityType', {}, NEW_LOT, 'facilityType is not specified in one of the requests.'],
    ['an unknown facilityType', { facilityType: 'pier' }, NEW_LOT, "Validation failed for field 'facilityType'"],
    ['a location outside lon/lat range', { facilityType: 'trail' }, { ...NEW_LOT, location: { type: 'point', coordinates: [-500, 50] } }, "Validation failed for field 'location'"],
    ['an unknown subtype', { facilityType: 'structure' }, { ...NEW_LOT, facilitySubType: 'castle' }, "Validation failed for field 'facilitySubType'"],
    ['a non-integer zoom', { facilityType: 'trail' }, { ...NEW_LOT, minMapZoom: 2.5 }, "Validation failed for field 'minMapZoom'"],
    ['no timezone', { facilityType: 'trail' }, { ...NEW_LOT, timezone: undefined }, "Mandatory field 'timezone' is missing in the request"],
  ])('400s with %s and writes nothing', async (_label, pathParameters, body, msg) => {
    const res = await postHandler(event({ pathParameters, body }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(msg);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s with no body', async () => {
    const res = await postHandler(event({ pathParameters: { facilityType: 'trail' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is required');
  });

  it('403s a user without staff on the collection', async () => {
    const res = await postHandler(event({ permissions: { other: 'staff' }, pathParameters: { facilityType: 'trail' }, body: NEW_LOT }));
    expect(res.statusCode).toBe(403);
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});

describe('PUT /facilities/{collectionId}/{facilityType}/{facilityId}', () => {
  const path = { facilityType: 'structure', facilityId: '1' };

  it('updates the facility addressed by the path and echoes the request', async () => {
    const res = await putHandler(event({ pathParameters: path, body: { displayName: 'Lot Z', pk: 'x', facilityId: 9 } }));

    expect(res.statusCode).toBe(200);
    const op = firstWrite();
    expect(op.action).toBe('Update');
    expect(unmarshall(op.data.Key)).toEqual({ pk: `facility::${COL}`, sk: 'structure::1' });
    expect(Object.values(op.data.ExpressionAttributeNames)).toEqual(expect.arrayContaining(['displayName', 'version', 'lastUpdated']));
    expect(Object.values(op.data.ExpressionAttributeNames)).not.toContain('pk');
    expect(parse(res).data).toEqual([{ key: { pk: `facility::${COL}`, sk: 'structure::1' }, data: { displayName: 'Lot Z' } }]);
  });

  it('accepts every updatable field', async () => {
    const body = {
      description: 'd', facilitySubType: 'yurt', location: { type: 'point', coordinates: [-123, 49] }, address: 'a',
      identifier: 1, isVisible: false, isOpen: true, closureStatus: 'Open', closureReason: '', passesRequired: false,
      timezone: 'America/Edmonton', minMapZoom: 1, maxMapZoom: 20, showOnMap: true, imageUrl: 'u', agreements: 'g',
      adminNotes: 'n', searchTerms: ['s'],
    };
    const res = await putHandler(event({ pathParameters: path, body }));
    expect(res.statusCode).toBe(200);
  });

  it('409s a rename onto another facility in the park', async () => {
    runQuery.mockResolvedValue({ items: [{ displayName: 'Lot A', sk: 'structure::5' }] });
    const res = await putHandler(event({ pathParameters: path, body: { displayName: 'Lot A' } }));
    expect(res.statusCode).toBe(409);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s on a timezone outside BC', async () => {
    const res = await putHandler(event({ pathParameters: path, body: { timezone: 'America/Toronto' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe("Validation failed for field 'timezone'");
  });

  it('400s when no facilityId is given', async () => {
    const res = await putHandler(event({ pathParameters: { facilityType: 'structure' }, body: { displayName: 'x' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('facilityId is not specified in one of the requests.');
  });

  it('400s with no body', async () => {
    const res = await putHandler(event({ pathParameters: path }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is required');
  });

  it('400s without a collectionId', async () => {
    const res = await putHandler({ ...event({ permissions: SUPERADMIN, body: { displayName: 'x' } }), pathParameters: {} });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Facility Collection Id (collectionId) is required');
  });
});

describe('DELETE /facilities/{collectionId}/{facilityType}/{facilityId}', () => {
  const path = { facilityType: 'structure', facilityId: '1' };

  it('removes relationships, then soft-deletes the facility as the caller', async () => {
    deleteEntityRelationships.mockResolvedValue({ deletedCount: 3 });

    const res = await deleteHandler(event({ sub: 'admin-7', pathParameters: path }));

    expect(res.statusCode).toBe(200);
    expect(deleteEntityRelationships).toHaveBeenCalledWith(`facility::${COL}`, 'structure::1');
    const op = firstWrite();
    expect(unmarshall(op.data.Key)).toEqual({ pk: `facility::${COL}`, sk: 'structure::1' });
    expect(op.data.UpdateExpression).toBe('SET isDeleted = :true, deletedAt = :deletedAt, deletedBy = :deletedBy');
    expect(unmarshall(op.data.ExpressionAttributeValues)).toMatchObject({ ':true': true, ':deletedBy': 'admin-7' });
    expect(parse(res).data.relationshipsDeleted).toBe(3);
  });

  // The handler has no checkAuthContext, so any caller can delete.
  test.failing('403s a caller without staff on the collection and deletes nothing', async () => {
    const res = await deleteHandler(event({ permissions: { other_9: 'staff' }, pathParameters: path }));
    expect(res.statusCode).toBe(403);
    expect(deleteEntityRelationships).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s when a body is sent', async () => {
    const res = await deleteHandler(event({ pathParameters: path, body: { sk: 'x' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is not allowed');
    expect(deleteEntityRelationships).not.toHaveBeenCalled();
  });

  it('400s without a facilityId', async () => {
    const res = await deleteHandler(event({ pathParameters: { facilityType: 'structure' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Facility Collection ID, Facility Type, and Facility ID are required');
  });
});
