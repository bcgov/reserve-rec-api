'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
  incrementCounter: jest.fn(),
  batchTransactData: jest.fn(),
  batchWriteData: jest.fn(),
}));
jest.mock('../../src/common/relationship-utils', () => ({
  ...jest.requireActual('../../src/common/relationship-utils'),
  deleteEntityRelationships: jest.fn(),
}));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOne, runQuery, batchGetData, incrementCounter, batchTransactData, batchWriteData } = require('/opt/dynamodb');
const { deleteEntityRelationships } = require('../../src/common/relationship-utils');
const { relationshipAudit } = require('../helpers/dynamoIo');
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
const writesTo = (table) => batchWriteData.mock.calls.filter(([, , t]) => t === table).flatMap(([items]) => items.map((i) => unmarshall(i)));
const relWrites = () => writesTo('reference-data');
const auditRecords = () => writesTo('audit');

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
      isVisible: true, imageUrl: 'u', searchTerms: ['s'],
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

  it('removes relationships, auditing each, then soft-deletes the activity as the caller', async () => {
    const rel = { pk: `rel::facility::${COL}::structure::1`, sk: `activity::${COL}::dayuse::4`, pk1: `facility::${COL}`, sk1: 'structure::1', pk2: `activity::${COL}`, sk2: 'dayuse::4' };
    deleteEntityRelationships.mockResolvedValue({ deletedCount: 1, deleted: [rel] });

    const res = await deleteHandler(event({ permissions: SUPERADMIN, sub: 'admin-7', pathParameters: path }));

    expect(res.statusCode).toBe(200);
    expect(deleteEntityRelationships).toHaveBeenCalledWith(`activity::${COL}`, 'dayuse::4');
    const op = firstWrite();
    expect(op.action).toBe('Update');
    expect(unmarshall(op.data.Key)).toEqual({ pk: `activity::${COL}`, sk: 'dayuse::4' });
    expect(op.data.UpdateExpression).toBe('SET isDeleted = :true, deletedAt = :deletedAt, deletedBy = :deletedBy');
    expect(unmarshall(op.data.ExpressionAttributeValues)).toMatchObject({ ':true': true, ':deletedBy': 'admin-7' });
    expect(op.data.ConditionExpression).toBe('attribute_exists(pk) AND attribute_exists(sk)');
    expect(parse(res).data.relationshipsDeleted).toBe(1);
    expect(auditRecords()).toEqual([relationshipAudit('RELATIONSHIP_DELETE', rel, 'admin-7')]);
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

  describe('fetchFacilities', () => {
    const LOT_A = { pk: `facility::${COL}`, sk: 'structure::1' };
    const GONE = { pk: `facility::${COL}`, sk: 'structure::2' };
    const rel = (f) => ({ pk1: f.pk, sk1: f.sk, pk2: `activity::${COL}`, sk2: 'dayuse::4' });
    const query = (fetchFacilities) => ({ activityType: 'dayuse', activityId: '4', fetchFacilities });

    beforeEach(() => {
      getOne.mockResolvedValue({ displayName: 'Joffre' });
      runQuery.mockResolvedValue({ items: [rel(LOT_A), rel(GONE)] });
      batchGetData.mockResolvedValue([{ ...LOT_A, displayName: 'Lot A', adminNotes: 'n' }, { ...GONE, isDeleted: true }]);
    });

    it.each([
      ['staff', STAFF, [{ ...LOT_A, displayName: 'Lot A' }]],
      ['superadmin', SUPERADMIN, [{ ...LOT_A, displayName: 'Lot A', adminNotes: 'n' }]],
    ])('expands the linked facilities for %s, dropping deleted ones', async (_label, permissions, facilities) => {
      const res = await getHandler(event({ permissions, queryStringParameters: query('true') }));

      expect(runQuery.mock.calls[0][0].ExpressionAttributeValues[':gsipk']).toEqual({ S: `rel::activity::${COL}::dayuse::4` });
      expect(batchGetData).toHaveBeenCalledWith([LOT_A, GONE], expect.any(String));
      expect(parse(res).data.facilities).toEqual(facilities);
    });

    it('does not expand when fetchFacilities is "false"', async () => {
      const res = await getHandler(event({ queryStringParameters: query('false') }));
      expect(runQuery).not.toHaveBeenCalled();
      expect(parse(res).data).toEqual({ displayName: 'Joffre' });
    });
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

describe('facilities and geozones on activity POST and PUT', () => {
  const FAC = { pk: `facility::${COL}`, sk: 'structure::1' };
  const GZ = { pk: `geozone::${COL}`, sk: '1' };
  const ACT = { pk: `activity::${COL}`, sk: 'dayuse::4' };
  const path = { activityType: 'dayuse', activityId: '4' };
  const post = (body, permissions = SUPERADMIN) => postHandler(event({ permissions, body, queryStringParameters: { activityType: 'dayuse' } }));
  const put = (body, permissions = SUPERADMIN) => putHandler(event({ permissions, body, pathParameters: path }));
  const link = (a, b) => ({ pk: `rel::${a.pk}::${a.sk}`, sk: `${b.pk}::${b.sk}`, pk1: a.pk, sk1: a.sk, pk2: b.pk, sk2: b.sk });
  const audit = (operation, a, b) => relationshipAudit(operation, link(a, b));
  const expectNothingWritten = () => {
    expect(incrementCounter).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
    expect(batchWriteData).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    batchGetData.mockImplementation(async (keys) => keys.map((k) => ({ ...k, displayName: 'x' })));
  });

  it('POST stores the links as relationship items, not on the activity, and audits each one', async () => {
    const res = await post({ displayName: 'Lot', facilities: [FAC], geozones: [GZ] });

    expect(res.statusCode).toBe(200);
    expect(unmarshall(firstWrite().data.Item)).not.toHaveProperty('facilities');
    expect(unmarshall(firstWrite().data.Item)).not.toHaveProperty('geozones');
    expect(relWrites()).toEqual([expect.objectContaining(link(FAC, ACT)), expect.objectContaining(link(GZ, ACT))]);
    expect(auditRecords()).toEqual(expect.arrayContaining([
      audit('RELATIONSHIP_CREATE', FAC, ACT), audit('RELATIONSHIP_CREATE', GZ, ACT),
    ]));
    expect(auditRecords()).toHaveLength(2);
  });

  it('PUT replaces the facility links, keeps them off the activity, and audits each change', async () => {
    const OLD = { pk: `facility::${COL}`, sk: 'structure::9' };
    runQuery.mockResolvedValue({ items: [link(OLD, ACT)] });

    const res = await put({ displayName: 'Lot', facilities: [FAC] });

    expect(res.statusCode).toBe(200);
    expect(Object.values(firstWrite().data.ExpressionAttributeNames)).not.toContain('facilities');
    expect(unmarshall(batchTransactData.mock.calls[1][0][0].data.Key)).toEqual({ pk: link(OLD, ACT).pk, sk: link(OLD, ACT).sk });
    expect(relWrites()).toEqual([expect.objectContaining(link(FAC, ACT))]);
    expect(auditRecords()).toEqual(expect.arrayContaining([
      audit('RELATIONSHIP_CREATE', FAC, ACT), audit('RELATIONSHIP_DELETE', OLD, ACT),
    ]));
    expect(auditRecords()).toHaveLength(2);
  });

  it('PUT with only facilities in the body updates the activity and syncs the links', async () => {
    runQuery.mockResolvedValue({ items: [] });

    const res = await put({ facilities: [FAC] });

    expect(res.statusCode).toBe(200);
    const op = firstWrite();
    expect(op.action).toBe('Update');
    expect(unmarshall(op.data.Key)).toEqual(ACT);
    expect(op.data.ConditionExpression).toBe('attribute_exists(pk)');
    expect(relWrites()).toEqual([expect.objectContaining(link(FAC, ACT))]);
  });

  it('PUT with an empty body still 400s', async () => {
    const res = await put({}, STAFF);
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('No field data provided with item.');
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('PUT without the fields leaves existing links alone', async () => {
    const res = await put({ displayName: 'Renamed' }, STAFF);

    expect(res.statusCode).toBe(200);
    expect(runQuery).not.toHaveBeenCalled();
    expect(batchTransactData).toHaveBeenCalledTimes(1);
    expect(batchWriteData).not.toHaveBeenCalled();
  });

  it.each([
    ['a facility in another collection', { facilities: [{ pk: 'facility::bcparks_2', sk: 'structure::1' }] }, 'pk must be facility::bcparks_1'],
    ['a geozone in another collection', { geozones: [{ pk: 'geozone::bcparks_2', sk: '1' }] }, 'pk must be geozone::bcparks_1'],
    ['a facilities entry that is not a facility', { facilities: [GZ] }, 'pk must be facility::bcparks_1'],
    ['an entry without an sk', { facilities: [{ pk: FAC.pk }] }, 'expected {pk, sk} strings'],
    ['a non-array field', { geozones: GZ }, 'geozones must be an array of {pk, sk}'],
    ['an array body item with a bad entry', [{ displayName: 'a', activityType: 'dayuse' }, { displayName: 'b', activityType: 'dayuse', facilities: [{ pk: 'facility::bcparks_2', sk: 'x' }] }], 'pk must be facility::bcparks_1'],
  ])('POST 400s on %s and writes nothing', async (_label, fields, msg) => {
    const res = await post(Array.isArray(fields) ? fields : { displayName: 'Lot', ...fields });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toContain(msg);
    expectNothingWritten();
  });

  it('PUT 400s on a facility in another collection and writes nothing', async () => {
    const res = await put({ facilities: [{ pk: 'facility::bcparks_2', sk: 'structure::1' }] });
    expect(res.statusCode).toBe(400);
    expectNothingWritten();
  });

  it.each([
    ['does not exist', []],
    ['is soft-deleted', [{ ...FAC, isDeleted: true }]],
  ])('400s when a linked facility %s and writes nothing', async (_label, found) => {
    batchGetData.mockResolvedValue(found);
    const res = await post({ displayName: 'Lot', facilities: [FAC] });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(`Linked entities not found: ${FAC.pk}::${FAC.sk}`);
    expectNothingWritten();
  });

  it('500s, writing nothing, when DynamoDB leaves the existence check unprocessed', async () => {
    batchGetData.mockResolvedValue(Object.assign([], { unprocessedKeys: [{}] }));
    const res = await post({ displayName: 'Lot', facilities: [FAC] });
    expect(res.statusCode).toBe(500);
    expect(parse(res).msg).toBe('Could not check the linked entities; try again');
    expectNothingWritten();
  });

  it.each([
    ['POST facilities', () => post({ displayName: 'Lot', facilities: [FAC] }, STAFF)],
    ['POST an empty geozones list', () => post({ displayName: 'Lot', geozones: [] }, STAFF)],
    ['POST facilities in one batch item', () => post([{ displayName: 'a' }, { displayName: 'b', facilities: [FAC] }], STAFF)],
    ['PUT geozones', () => put({ geozones: [GZ] }, STAFF)],
    ['PUT an empty facilities list', () => put({ facilities: [] }, STAFF)],
  ])('403s staff sending %s and writes nothing', async (_label, send) => {
    const res = await send();
    expect(res.statusCode).toBe(403);
    expect(batchGetData).not.toHaveBeenCalled();
    expectNothingWritten();
  });
});
