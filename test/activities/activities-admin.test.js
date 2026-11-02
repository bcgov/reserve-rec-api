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
  deleteEntityRelationships: jest.fn(),
}));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOne, runQuery, batchGetData, incrementCounter, batchTransactData } = require('/opt/dynamodb');
const { deleteEntityRelationships } = require('../../src/common/relationship-utils');
const { handler: getHandler } = require('../../src/handlers/activities/_collectionId/GET/admin');
const { handler: postHandler } = require('../../src/handlers/activities/_collectionId/POST/admin');
const { handler: putHandler } = require('../../src/handlers/activities/_collectionId/PUT/admin');
const { handler: deleteHandler } = require('../../src/handlers/activities/_collectionId/DELETE/admin');

const COL = 'bcparks_1';
const STAFF = { [COL]: 'staff' };
const SUPERADMIN = { superadmin: 'superadmin' };

const event = ({ permissions = STAFF, sub = 'user-1', body, pathParameters = {}, queryStringParameters } = {}) => ({
  requestContext: { authorizer: { principalId: sub, permissions: JSON.stringify(permissions) } },
  pathParameters: { collectionId: COL, ...pathParameters },
  queryStringParameters,
  body: body === undefined ? null : JSON.stringify(body),
});
const parse = (res) => JSON.parse(res.body);
const firstWrite = () => batchTransactData.mock.calls[0][0][0];

beforeEach(() => {
  jest.clearAllMocks();
  batchTransactData.mockResolvedValue({});
  incrementCounter.mockResolvedValue(4);
});

describe('POST /activities/{collectionId}', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
  });
  afterEach(() => {
    global.setTimeout.mockRestore();
  });

  it('creates the activity under the next id for its type', async () => {
    const res = await postHandler(event({ body: { displayName: 'Joffre Lakes' }, queryStringParameters: { activityType: 'dayuse' } }));

    expect(res.statusCode).toBe(200);
    expect(incrementCounter).toHaveBeenCalledWith(`activity::${COL}`, ['dayuse']);
    const op = firstWrite();
    expect(op.action).toBe('Put');
    expect(op.data.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    expect(unmarshall(op.data.Item)).toMatchObject({
      pk: `activity::${COL}`, sk: 'dayuse::4', collectionId: COL, schema: 'activity',
      activityType: 'dayuse', activityId: 4, identifier: 4, displayName: 'Joffre Lakes', version: 1,
    });
    expect(parse(res).data).toEqual([expect.objectContaining({ key: { pk: `activity::${COL}`, sk: 'dayuse::4' } })]);
  });

  it('accepts every optional activity field', async () => {
    const body = {
      displayName: 'Lot day pass', activityType: 'dayuse', description: 'd', activitySubType: 'vehicleParking',
      geozones: [{ pk: 'geozone::bcparks_1', sk: '1' }], facilities: [{ pk: `facility::${COL}`, sk: 'structure::1' }],
      isVisible: false, imageUrl: 'https://img', searchTerms: ['lot'], adminNotes: 'n', price: 10,
      transactionFeePercent: 2.5, taxPercent: 5,
    };
    const res = await postHandler(event({ body }));
    expect(res.statusCode).toBe(200);
    expect(unmarshall(firstWrite().data.Item)).toMatchObject(body);
  });

  it('drops an empty activitySubType instead of storing it', async () => {
    await postHandler(event({ body: { displayName: 'x', activityType: 'dayuse', activitySubType: null } }));
    expect(unmarshall(firstWrite().data.Item)).not.toHaveProperty('activitySubType');
  });

  it('retries with a fresh id when the write fails once', async () => {
    incrementCounter.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    batchTransactData.mockRejectedValueOnce(new Error('conflict')).mockResolvedValueOnce({});

    const res = await postHandler(event({ body: { displayName: 'x', activityType: 'dayuse' } }));

    expect(res.statusCode).toBe(200);
    expect(unmarshall(batchTransactData.mock.calls[1][0][0].data.Item).sk).toBe('dayuse::5');
  });

  it('returns the write error once retries run out', async () => {
    batchTransactData.mockRejectedValue(Object.assign(new Error('still conflicting'), { code: 409 }));
    const res = await postHandler(event({ body: { displayName: 'x', activityType: 'dayuse' } }));
    expect(res.statusCode).toBe(409);
    expect(parse(res).msg).toBe('still conflicting');
  });

  it.each([
    ['no activityType', { displayName: 'x' }, 'activityType is not specified in one of the requests.'],
    ['an unknown activityType', { displayName: 'x', activityType: 'skiing' }, "Validation failed for field 'activityType'"],
    ['a bad geozone key', { displayName: 'x', activityType: 'dayuse', geozones: [{ pk: 'g' }] }, "Validation failed for field 'geozones'"],
    ['a string price', { displayName: 'x', activityType: 'dayuse', price: '10' }, "Validation failed for field 'price'"],
    ['no displayName', { activityType: 'dayuse' }, "Mandatory field 'displayName' is missing in the request"],
  ])('400s with %s and writes nothing', async (_label, body, msg) => {
    const res = await postHandler(event({ body }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(msg);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s with no body', async () => {
    const res = await postHandler(event());
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is required');
  });

  it('403s a user without staff on the collection', async () => {
    const res = await postHandler(event({ permissions: { other_col: 'staff' }, body: { displayName: 'x', activityType: 'dayuse' } }));
    expect(res.statusCode).toBe(403);
    expect(incrementCounter).not.toHaveBeenCalled();
  });
});

describe('PUT /activities/{collectionId}/{activityType}/{activityId}', () => {
  const path = { activityType: 'dayuse', activityId: '4' };

  it('updates the existing activity addressed by the path', async () => {
    const res = await putHandler(event({ pathParameters: path, body: { displayName: 'Renamed', pk: 'x', activityId: 9 } }));

    expect(res.statusCode).toBe(200);
    const op = firstWrite();
    expect(op.action).toBe('Update');
    expect(unmarshall(op.data.Key)).toEqual({ pk: `activity::${COL}`, sk: 'dayuse::4' });
    expect(op.data.ConditionExpression).toBe('attribute_exists(pk)');
    expect(Object.values(op.data.ExpressionAttributeNames)).toEqual(expect.arrayContaining(['displayName', 'version']));
    expect(Object.values(op.data.ExpressionAttributeNames)).not.toEqual(expect.arrayContaining(['pk']));
    expect(Object.values(unmarshall(op.data.ExpressionAttributeValues))).toContain('Renamed');
  });

  it('accepts every updatable field', async () => {
    const body = {
      displayName: 'n', description: 'd', schema: 'activity', activitySubType: 'walkin', identifier: 4,
      geozones: [], facilities: [{ pk: 'f', sk: '1' }], isVisible: true, imageUrl: 'u', searchTerms: ['s'],
      adminNotes: 'a', price: 1, transactionFeePercent: 0, taxPercent: 12,
    };
    const res = await putHandler(event({ pathParameters: path, body }));
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['a non-boolean isVisible', { isVisible: 'yes' }, "Validation failed for field 'isVisible'"],
    ['a field outside the update config', { collectionId: 'other' }, 'Invalid field.'],
  ])('400s on %s', async (_label, body, msg) => {
    const res = await putHandler(event({ pathParameters: path, body }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(msg);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s when no activityId is given', async () => {
    const res = await putHandler(event({ pathParameters: { activityType: 'dayuse' }, body: { displayName: 'x' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('activityId is not specified in one of the requests.');
  });

  it('400s with no body', async () => {
    const res = await putHandler(event({ pathParameters: path }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is required');
  });

  it('403s a user with only limited access to the collection', async () => {
    const res = await putHandler(event({ permissions: { [COL]: 'limited' }, pathParameters: path, body: { displayName: 'x' } }));
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /activities/{collectionId}/{activityType}/{activityId}', () => {
  const path = { activityType: 'dayuse', activityId: '4' };

  it('removes relationships, then soft-deletes the activity as the caller', async () => {
    deleteEntityRelationships.mockResolvedValue({ deletedCount: 2 });

    const res = await deleteHandler(event({ permissions: SUPERADMIN, sub: 'admin-7', pathParameters: path }));

    expect(res.statusCode).toBe(200);
    expect(deleteEntityRelationships).toHaveBeenCalledWith(`activity::${COL}`, 'dayuse::4');
    const op = firstWrite();
    expect(op.action).toBe('Update');
    expect(unmarshall(op.data.Key)).toEqual({ pk: `activity::${COL}`, sk: 'dayuse::4' });
    expect(op.data.UpdateExpression).toBe('SET isDeleted = :true, deletedAt = :deletedAt, deletedBy = :deletedBy');
    expect(unmarshall(op.data.ExpressionAttributeValues)).toMatchObject({ ':true': true, ':deletedBy': 'admin-7' });
    expect(op.data.ConditionExpression).toBe('attribute_exists(pk) AND attribute_exists(sk)');
    expect(parse(res).data.relationshipsDeleted).toBe(2);
  });

  it('403s staff: only superadmins delete activities', async () => {
    const res = await deleteHandler(event({ permissions: { [COL]: 'staff' }, pathParameters: path }));
    expect(res.statusCode).toBe(403);
    expect(deleteEntityRelationships).not.toHaveBeenCalled();
  });

  it('400s when a body is sent', async () => {
    const res = await deleteHandler(event({ permissions: SUPERADMIN, pathParameters: path, body: { sk: 'x' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is not allowed');
  });

  it('400s without an activityId', async () => {
    const res = await deleteHandler(event({ permissions: SUPERADMIN, pathParameters: { activityType: 'dayuse' } }));
    expect(res.statusCode).toBe(400);
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});

describe('GET /activities/{collectionId} (admin)', () => {
  it('answers a CORS preflight', async () => {
    const res = await getHandler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
  });

  it('hides adminNotes on a single activity from non-superadmins', async () => {
    getOne.mockResolvedValue({ displayName: 'Joffre', adminNotes: 'secret' });

    const res = await getHandler(event({ queryStringParameters: { activityType: 'dayuse', activityId: '4' } }));

    expect(getOne).toHaveBeenCalledWith(`activity::${COL}`, 'dayuse::4');
    expect(parse(res).data).toEqual({ displayName: 'Joffre' });
  });

  it('shows adminNotes to superadmins', async () => {
    getOne.mockResolvedValue({ displayName: 'Joffre', adminNotes: 'secret' });
    const res = await getHandler(event({ permissions: SUPERADMIN, queryStringParameters: { activityType: 'dayuse', activityId: '4' } }));
    expect(parse(res).data).toEqual({ displayName: 'Joffre', adminNotes: 'secret' });
  });

  it('expands facility keys when fetchFacilities is set', async () => {
    const keys = [{ pk: `facility::${COL}`, sk: 'structure::1' }];
    getOne.mockResolvedValue({ displayName: 'Joffre', facilities: keys });
    batchGetData.mockResolvedValue([{ displayName: 'Lot A' }]);

    const res = await getHandler(event({ permissions: SUPERADMIN, queryStringParameters: { activityType: 'dayuse', activityId: '4', fetchFacilities: 'true' } }));

    expect(batchGetData).toHaveBeenCalledWith(keys, expect.any(String));
    expect(parse(res).data.facilities).toEqual([{ displayName: 'Lot A' }]);
  });

  it('treats a soft-deleted activity as not found', async () => {
    getOne.mockResolvedValue({ displayName: 'gone', isDeleted: true });
    const res = await getHandler(event({ queryStringParameters: { activityType: 'dayuse', activityId: '4' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toBeNull();
  });

  it('400s when reading the activity fails', async () => {
    getOne.mockRejectedValue(new Error('down'));
    const res = await getHandler(event({ queryStringParameters: { activityType: 'dayuse', activityId: '4' } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting activity');
  });

  it('lists one type with filters, excluding deleted rows but not hidden ones', async () => {
    runQuery.mockResolvedValue({ items: [{ sk: 'dayuse::1' }] });

    await getHandler(event({ queryStringParameters: { activityType: 'dayuse', isVisible: 'false', subActivityType: 'walkin' } }));

    const query = runQuery.mock.calls[0][0];
    expect(query.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :sk)');
    expect(query.ExpressionAttributeValues).toMatchObject({
      ':pk': { S: `activity::${COL}` }, ':sk': { S: 'dayuse::' },
      ':isVisible': { BOOL: false }, ':subActivityType': { S: 'walkin' }, ':notDeleted': { BOOL: false },
    });
    expect(query.FilterExpression).toBe(
      '(#isVisible = :isVisible AND contains(#subActivityType, :subActivityType)) AND (attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted)',
    );
    expect(query.ExpressionAttributeValues).not.toHaveProperty(':visible');
  });

  it('lists the whole collection when no type is given', async () => {
    runQuery.mockResolvedValue({ items: [] });
    await getHandler(event());
    const query = runQuery.mock.calls[0][0];
    expect(query.KeyConditionExpression).toBe('pk = :pk');
    expect(query.FilterExpression).toBe('(attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted)');
  });

  it('400s when the list query fails', async () => {
    runQuery.mockRejectedValue(new Error('down'));
    const res = await getHandler(event());
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting activities');
  });

  it('400s without a collectionId', async () => {
    const res = await getHandler({ ...event(), pathParameters: {} });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Activity Collection ID (collectionId) is required');
  });
});
