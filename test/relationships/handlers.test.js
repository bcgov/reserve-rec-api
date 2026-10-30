'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  batchGetData: jest.fn(),
  batchTransactData: jest.fn(),
}));

const { runQuery, getOne, batchGetData, batchTransactData } = require('/opt/dynamodb');
const { adminEvent, parse } = require('../helpers/adminEvent');
const POST = require('../../src/handlers/relationships/POST/admin').handler;
const GET_FROM = require('../../src/handlers/relationships/_compoundPk1/_compoundSk1/GET/admin').handler;
const GET_TO = require('../../src/handlers/relationships/reverse/_compoundPk2/_compoundSk2/GET/admin').handler;
const DELETE = require('../../src/handlers/relationships/_compoundPk1/_compoundSk1/_compoundPk2/_compoundSk2/DELETE/admin').handler;

const FAC = { pk: 'facility::bcparks_1', sk: 'campground::2' };
const ACT = { pk: 'activity::bcparks_1', sk: 'backcountryCamp::3' };
const row = (a, b) => ({ pk: `rel::${a.pk}::${a.sk}`, sk: `${b.pk}::${b.sk}`, pk1: a.pk, sk1: a.sk, pk2: b.pk, sk2: b.sk });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('POST /relationships', () => {
  it('stores a row keyed for forward and reverse lookup', async () => {
    getOne.mockResolvedValue(null);
    batchTransactData.mockResolvedValue({ ok: true });

    const res = await POST(adminEvent({ httpMethod: 'POST', body: { pk1: FAC.pk, sk1: FAC.sk, pk2: ACT.pk, sk2: ACT.sk } }));

    expect(res.statusCode).toBe(200);
    const [[put]] = batchTransactData.mock.calls[0];
    expect(put.action).toBe('Put');
    expect(put.data.Item).toMatchObject({
      pk: { S: 'rel::facility::bcparks_1::campground::2' },
      sk: { S: 'activity::bcparks_1::backcountryCamp::3' },
      gsipk: { S: 'rel::activity::bcparks_1::backcountryCamp::3' },
      gsisk: { S: 'facility::bcparks_1::campground::2' },
      schema: { S: 'relationship' },
      schema1: { S: 'facility' },
      schema2: { S: 'activity' },
      version: { N: '1' },
    });
  });

  it('400s naming each missing key part', async () => {
    const res = await POST(adminEvent({ httpMethod: 'POST', body: { pk1: FAC.pk, sk1: FAC.sk } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Cannot create relationship - missing required parameter(s): pk2, sk2');
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s an entity schema that cannot be related', async () => {
    getOne.mockResolvedValue(null);
    const res = await POST(adminEvent({ httpMethod: 'POST', body: { pk1: 'park::bcparks_1', sk1: 'x', pk2: ACT.pk, sk2: ACT.sk } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe("Validation failed for field 'schema1'");
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});

describe('GET /relationships/{pk1}/{sk1}', () => {
  const path = { pk1: FAC.pk, sk1: FAC.sk };

  it('returns forward rows filtered by target schema', async () => {
    runQuery.mockResolvedValue({ items: [row(FAC, ACT)] });
    const res = await GET_FROM(adminEvent({ pathParameters: path, queryStringParameters: { targetSchema: 'activity' } }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ items: [row(FAC, ACT)], count: 1 });
    expect(runQuery.mock.calls[0][0].ExpressionAttributeValues).toEqual({
      ':pk': { S: 'rel::facility::bcparks_1::campground::2' }, ':sk': { S: 'activity::' },
    });
  });

  it('bidirectional merges reverse rows once and expands the far end, hiding out-of-scope adminNotes', async () => {
    const GZ2 = { pk: 'geozone::bcparks_2', sk: '1' };
    batchGetData.mockResolvedValue([{ ...ACT, adminNotes: 'mine' }, { ...GZ2, adminNotes: 'theirs' }]);
    runQuery
      .mockResolvedValueOnce({ items: [row(FAC, ACT)] })
      .mockResolvedValueOnce({ items: [row(GZ2, FAC), row(FAC, ACT)] });

    const res = await GET_FROM(adminEvent({
      permissions: { bcparks_1: 'staff' },
      pathParameters: path,
      queryStringParameters: { bidirectional: 'true', expand: 'true' },
    }));

    const { items, count } = parse(res).data;
    expect(count).toBe(2);
    expect(runQuery.mock.calls[1][0].IndexName).toBe('entityRelationship-index');
    expect(items.map((i) => i.entity)).toEqual([
      { ...ACT, adminNotes: 'mine' },
      { pk: 'geozone::bcparks_2', sk: '1' },
    ]);
  });

  it('reports a query failure with its code', async () => {
    runQuery.mockRejectedValue(new Error('throttled'));
    const res = await GET_FROM(adminEvent({ pathParameters: path }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).data).toEqual({ error: 'Failed to get relationships', message: 'Error getting Relationships' });
  });
});

describe('GET /relationships/reverse/{pk2}/{sk2}', () => {
  it('queries the GSI filtered by source schema', async () => {
    runQuery.mockResolvedValue({ items: [row(FAC, ACT)] });
    const res = await GET_TO(adminEvent({ pathParameters: { pk2: ACT.pk, sk2: ACT.sk }, queryStringParameters: { sourceSchema: 'facility' } }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ items: [row(FAC, ACT)], count: 1 });
    expect(runQuery.mock.calls[0][0]).toMatchObject({
      IndexName: 'entityRelationship-index',
      KeyConditionExpression: 'gsipk = :gsipk AND begins_with(gsisk, :gsisk)',
      ExpressionAttributeValues: { ':gsipk': { S: 'rel::activity::bcparks_1::backcountryCamp::3' }, ':gsisk': { S: 'facility::' } },
    });
  });

  it('turns a query failure into a 400', async () => {
    runQuery.mockRejectedValue(new Error('throttled'));
    const res = await GET_TO(adminEvent({ pathParameters: { pk2: ACT.pk, sk2: ACT.sk } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting Relationships via GSI');
  });
});

describe('DELETE /relationships/{pk1}/{sk1}/{pk2}/{sk2}', () => {
  it('deletes the one row for that pair', async () => {
    batchTransactData.mockResolvedValue({});
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', pathParameters: { pk1: FAC.pk, sk1: FAC.sk, pk2: ACT.pk, sk2: ACT.sk } }));

    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ deleted: true, pk: row(FAC, ACT).pk, sk: row(FAC, ACT).sk });
    expect(batchTransactData).toHaveBeenCalledWith([{
      action: 'Delete',
      data: { TableName: 'reference-data', Key: { pk: { S: row(FAC, ACT).pk }, sk: { S: row(FAC, ACT).sk } } },
    }]);
  });

  // The handler has no checkAuthContext, so any caller can delete.
  test.failing('403s a caller without staff on the collection and deletes nothing', async () => {
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', permissions: { bcparks_9: 'staff' }, pathParameters: { pk1: FAC.pk, sk1: FAC.sk, pk2: ACT.pk, sk2: ACT.sk } }));
    expect(res.statusCode).toBe(403);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing key part', { pathParameters: { pk1: FAC.pk, sk1: FAC.sk, pk2: ACT.pk } }],
    ['a body', { pathParameters: { pk1: FAC.pk, sk1: FAC.sk, pk2: ACT.pk, sk2: ACT.sk }, body: { a: 1 } }],
  ])('400s with %s and deletes nothing', async (_label, opts) => {
    const res = await DELETE(adminEvent({ httpMethod: 'DELETE', ...opts }));
    expect(res.statusCode).toBe(400);
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});
