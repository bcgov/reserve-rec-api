'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
  batchWriteData: jest.fn(),
  batchTransactData: jest.fn(),
  getOne: jest.fn(),
}));

const { runQuery, batchGetData, batchWriteData, batchTransactData } = require('/opt/dynamodb');
const rel = require('../../src/common/relationship-utils');

const GZ = { pk: 'geozone::bcparks_1', sk: '1' };
const FAC = { pk: 'facility::bcparks_1', sk: 'campground::2' };
const ACT = { pk: 'activity::bcparks_1', sk: 'backcountryCamp::3' };

// Unmarshalled relationship row as runQuery returns it.
const row = (a, b) => ({
  pk: `rel::${a.pk}::${a.sk}`, sk: `${b.pk}::${b.sk}`,
  pk1: a.pk, sk1: a.sk, pk2: b.pk, sk2: b.sk,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('createRelationshipItem', () => {
  it('builds a marshalled row queryable from both ends', () => {
    expect(rel.createRelationshipItem(GZ.pk, GZ.sk, FAC.pk, FAC.sk)).toEqual({
      pk: { S: 'rel::geozone::bcparks_1::1' },
      sk: { S: 'facility::bcparks_1::campground::2' },
      gsipk: { S: 'rel::facility::bcparks_1::campground::2' },
      gsisk: { S: 'geozone::bcparks_1::1' },
      schema: { S: 'relationship' },
      schema1: { S: 'geozone' },
      schema2: { S: 'facility' },
      pk1: { S: GZ.pk }, sk1: { S: GZ.sk },
      pk2: { S: FAC.pk }, sk2: { S: FAC.sk },
    });
  });
});

describe('extractAndCreateRelationships', () => {
  it('puts the higher-hierarchy entity first, skips keyless entries and strips the fields', () => {
    const { cleanedData, relationshipItems } = rel.extractAndCreateRelationships(
      'activity', ACT.pk, ACT.sk,
      { displayName: 'Camp', geozones: [GZ, { pk: 'geozone::x' }], facilities: [FAC], products: [] },
      ['geozones', 'facilities', 'products'],
    );

    expect(cleanedData).toEqual({ displayName: 'Camp' });
    expect(relationshipItems.map((r) => [r.PutRequest.Item.pk1.S, r.PutRequest.Item.pk2.S])).toEqual([
      [GZ.pk, ACT.pk],
      [FAC.pk, ACT.pk],
    ]);
  });

  it('keeps source first when it already outranks the target', () => {
    const { relationshipItems } = rel.extractAndCreateRelationships('geozone', GZ.pk, GZ.sk, { facilities: [FAC] }, ['facilities']);
    expect(relationshipItems[0].PutRequest.Item.pk.S).toBe('rel::geozone::bcparks_1::1');
  });
});

describe('queryRelationshipsBySchema', () => {
  it('queries the GSI when the source ranks below the target', async () => {
    runQuery.mockResolvedValue({ items: [row(FAC, ACT)] });
    await expect(rel.queryRelationshipsBySchema(ACT.pk, ACT.sk, 'facility', 'RefTable')).resolves.toEqual([row(FAC, ACT)]);
    expect(runQuery).toHaveBeenCalledWith({
      TableName: 'RefTable',
      IndexName: 'entityRelationship-index',
      KeyConditionExpression: 'gsipk = :gsipk',
      FilterExpression: 'schema1 = :schema1',
      ExpressionAttributeValues: { ':gsipk': { S: 'rel::activity::bcparks_1::backcountryCamp::3' }, ':schema1': { S: 'facility' } },
    }, null, null, false);
  });

  it('queries the table by pk when the source ranks above the target', async () => {
    runQuery.mockResolvedValue({});
    await expect(rel.queryRelationshipsBySchema(FAC.pk, FAC.sk, 'activity', 'RefTable')).resolves.toEqual([]);
    expect(runQuery.mock.calls[0][0]).toEqual({
      TableName: 'RefTable',
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: 'schema2 = :schema2',
      ExpressionAttributeValues: { ':pk': { S: 'rel::facility::bcparks_1::campground::2' }, ':schema2': { S: 'activity' } },
    });
  });
});

describe('diffRelationships', () => {
  const ACT2 = { pk: 'activity::bcparks_1', sk: 'dayuse::4' };
  const ACT3 = { pk: 'activity::bcparks_1', sk: 'dayuse::5' };

  it('adds incoming targets that are new and deletes stored ones no longer sent', () => {
    const { toAdd, toDelete } = rel.diffRelationships(
      [row(FAC, ACT), row(FAC, ACT2)], [ACT2, ACT3], FAC.pk, FAC.sk, 'activity', 'RefTable',
    );
    expect(toAdd).toEqual([{ PutRequest: { Item: rel.createRelationshipItem(FAC.pk, FAC.sk, ACT3.pk, ACT3.sk) } }]);
    expect(toDelete).toEqual([{
      action: 'Delete',
      data: { TableName: 'RefTable', Key: { pk: { S: row(FAC, ACT).pk }, sk: { S: row(FAC, ACT).sk } } },
    }]);
  });

  it('reads the target from pk1 and writes the target first when the source ranks lower', () => {
    const FAC2 = { pk: 'facility::bcparks_1', sk: 'campground::9' };
    const { toAdd, toDelete } = rel.diffRelationships([row(FAC, ACT)], [FAC, FAC2], ACT.pk, ACT.sk, 'facility', 'RefTable');
    expect(toDelete).toEqual([]);
    expect(toAdd).toEqual([{ PutRequest: { Item: rel.createRelationshipItem(FAC2.pk, FAC2.sk, ACT.pk, ACT.sk) } }]);
  });

  it('deletes everything when nothing is sent', () => {
    expect(rel.diffRelationships([row(FAC, ACT)], undefined, FAC.pk, FAC.sk, 'activity', 'T').toDelete).toHaveLength(1);
  });
});

describe('batchWriteRelationships', () => {
  it('writes the raw items in batches of 25 and skips an empty list', async () => {
    await rel.batchWriteRelationships([], 'RefTable');
    expect(batchWriteData).not.toHaveBeenCalled();

    const item = rel.createRelationshipItem(GZ.pk, GZ.sk, FAC.pk, FAC.sk);
    await rel.batchWriteRelationships([{ PutRequest: { Item: item } }], 'RefTable');
    expect(batchWriteData).toHaveBeenCalledWith([item], 25, 'RefTable');
  });
});

describe('createEntityWithRelationships', () => {
  const putConfig = { failOnError: true, fields: { pk: {}, sk: {}, displayName: {} } };
  const parsed = () => [{ key: { ...ACT }, data: { pk: ACT.pk, sk: ACT.sk, displayName: 'Camp', facilities: [FAC] } }];

  it('POST writes the entity without relationship fields, then the relationship rows', async () => {
    const parseRequest = jest.fn().mockResolvedValue(parsed());
    const out = await rel.createEntityWithRelationships({
      schema: 'activity', collectionId: 'bcparks_1', body: { b: 1 }, parseArgs: ['backcountryCamp'],
      relationshipFields: ['facilities'], putConfig, parseRequest, tableName: 'RefTable',
    });

    expect(parseRequest).toHaveBeenCalledWith('bcparks_1', { b: 1 }, 'POST', 'backcountryCamp');
    expect(batchTransactData).toHaveBeenCalledTimes(1);
    const [put] = batchTransactData.mock.calls[0][0];
    expect(put.action).toBe('Put');
    expect(put.data.Item).not.toHaveProperty('facilities');
    expect(batchWriteData).toHaveBeenCalledWith([rel.createRelationshipItem(FAC.pk, FAC.sk, ACT.pk, ACT.sk)], 25, 'RefTable');
    expect(out[0].data).toEqual({ pk: ACT.pk, sk: ACT.sk, displayName: 'Camp' });
  });

  it('PUT updates the entity, deletes stale relationships and adds new ones', async () => {
    const FAC_OLD = { pk: 'facility::bcparks_1', sk: 'campground::1' };
    runQuery.mockResolvedValue({ items: [row(FAC_OLD, ACT)] });
    const parseRequest = jest.fn().mockResolvedValue([{ key: { ...ACT }, data: { displayName: 'Camp', facilities: [FAC] } }]);

    await rel.createEntityWithRelationships({
      schema: 'activity', collectionId: 'bcparks_1', body: {}, requestMethod: 'PUT',
      relationshipFields: ['facilities'], putConfig: { fields: { displayName: {} } }, parseRequest, tableName: 'RefTable',
    });

    expect(batchTransactData).toHaveBeenCalledTimes(2);
    const [update] = batchTransactData.mock.calls[0][0];
    expect(update.action).toBe('Update');
    expect(update.data.ExpressionAttributeNames).toEqual({ '#displayName': 'displayName' });
    expect(batchTransactData.mock.calls[1][0]).toEqual([{
      action: 'Delete',
      data: { TableName: 'RefTable', Key: { pk: { S: row(FAC_OLD, ACT).pk }, sk: { S: row(FAC_OLD, ACT).sk } } },
    }]);
    expect(batchWriteData).toHaveBeenCalledWith([rel.createRelationshipItem(FAC.pk, FAC.sk, ACT.pk, ACT.sk)], 25, 'RefTable');
  });

  it('re-parses and retries when the write fails, and succeeds on the next attempt', async () => {
    const parseRequest = jest.fn().mockImplementation(async () => parsed());
    batchTransactData.mockRejectedValueOnce(new Error('TransactionCanceled')).mockResolvedValue({});

    await rel.createEntityWithRelationships({
      schema: 'activity', collectionId: 'bcparks_1', body: {}, relationshipFields: ['facilities'],
      putConfig, parseRequest, maxRetries: 2,
    });

    expect(parseRequest).toHaveBeenCalledTimes(2);
    expect(batchTransactData).toHaveBeenCalledTimes(2);
    expect(batchWriteData).toHaveBeenCalledTimes(1);
  });

  it('throws the last error once retries run out', async () => {
    batchTransactData.mockRejectedValue(new Error('TransactionCanceled'));
    await expect(rel.createEntityWithRelationships({
      schema: 'activity', collectionId: 'bcparks_1', body: {}, relationshipFields: ['facilities'],
      putConfig, parseRequest: jest.fn().mockResolvedValue(parsed()), maxRetries: 1,
    })).rejects.toThrow('TransactionCanceled');
    expect(batchWriteData).not.toHaveBeenCalled();
  });
});

describe('deleteEntityRelationships', () => {
  it('deletes forward and reverse rows together and reports the counts', async () => {
    runQuery
      .mockResolvedValueOnce({ items: [row(FAC, ACT), row(FAC, { pk: 'activity::bcparks_1', sk: 'x' })] })
      .mockResolvedValueOnce({ items: [row(GZ, FAC)] });

    await expect(rel.deleteEntityRelationships(FAC.pk, FAC.sk, 'RefTable'))
      .resolves.toEqual({ deletedCount: 3, forwardRelationships: 2, reverseRelationships: 1 });
    expect(runQuery.mock.calls[0][0].KeyConditionExpression).toBe('pk = :pk');
    expect(runQuery.mock.calls[1][0].IndexName).toBe('entityRelationship-index');
    expect(batchTransactData).toHaveBeenCalledTimes(1);
    expect(batchTransactData.mock.calls[0][0].map((d) => d.data.Key.pk.S))
      .toEqual([row(FAC, ACT).pk, row(FAC, ACT).pk, row(GZ, FAC).pk]);
  });

  it('still deletes forward rows when the GSI query fails', async () => {
    runQuery.mockResolvedValueOnce({ items: [row(FAC, ACT)] }).mockRejectedValueOnce(new Error('no index'));
    await expect(rel.deleteEntityRelationships(FAC.pk, FAC.sk))
      .resolves.toEqual({ deletedCount: 1, forwardRelationships: 1, reverseRelationships: 0 });
    expect(batchTransactData).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when there are no relationships', async () => {
    runQuery.mockResolvedValue({});
    await expect(rel.deleteEntityRelationships(FAC.pk, FAC.sk))
      .resolves.toEqual({ deletedCount: 0, forwardRelationships: 0, reverseRelationships: 0 });
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('splits more than 100 deletes into transactions of at most 100', async () => {
    const many = Array.from({ length: 150 }, (_, i) => row(FAC, { pk: 'activity::bcparks_1', sk: `a::${i}` }));
    runQuery.mockResolvedValueOnce({ items: many }).mockResolvedValueOnce({ items: [] });
    await rel.deleteEntityRelationships(FAC.pk, FAC.sk);
    expect(batchTransactData.mock.calls.map((c) => c[0].length)).toEqual([100, 50]);
  });
});

describe('expandRelationships', () => {
  const SRC = `rel::${FAC.pk}::${FAC.sk}`;

  it('returns [] for no relationships without fetching', async () => {
    await expect(rel.expandRelationships([])).resolves.toEqual([]);
    expect(batchGetData).not.toHaveBeenCalled();
  });

  it('attaches the pk2 entity by default, fetching each key once', async () => {
    batchGetData.mockResolvedValue([{ ...ACT, displayName: 'Camp' }]);
    const out = await rel.expandRelationships([row(FAC, ACT), row(GZ, ACT)]);
    expect(batchGetData).toHaveBeenCalledWith([{ pk: ACT.pk, sk: ACT.sk }], 'reference-data');
    expect(out.map((r) => r.entity?.displayName)).toEqual(['Camp', 'Camp']);
  });

  it('bidirectional attaches the far end of each row and null when it is missing', async () => {
    batchGetData.mockResolvedValue([{ ...ACT, displayName: 'Camp' }]);
    const out = await rel.expandRelationships([row(FAC, ACT), row(GZ, FAC)], true, SRC);
    expect(batchGetData).toHaveBeenCalledWith([{ pk: ACT.pk, sk: ACT.sk }, { pk: GZ.pk, sk: GZ.sk }], 'reference-data');
    expect(out[0].entity.displayName).toBe('Camp');
    expect(out[1].entity).toBeNull();
  });
});

describe('getRelationshipsByPk / getRelationshipsByGsipk', () => {
  it('filters forward rows by target schema prefix and passes paging through', async () => {
    runQuery.mockResolvedValue({ items: [] });
    await rel.getRelationshipsByPk('rel::x', 'activity', { limit: 5, lastEvaluatedKey: 'k', paginated: false });
    expect(runQuery).toHaveBeenCalledWith({
      TableName: 'reference-data',
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': { S: 'rel::x' }, ':sk': { S: 'activity::' } },
    }, 5, 'k', false);
  });

  it('filters reverse rows by source schema prefix on the GSI, paginated by default', async () => {
    runQuery.mockResolvedValue({ items: [] });
    await rel.getRelationshipsByGsipk('rel::y', 'geozone');
    expect(runQuery).toHaveBeenCalledWith({
      TableName: 'reference-data',
      IndexName: 'entityRelationship-index',
      KeyConditionExpression: 'gsipk = :gsipk AND begins_with(gsisk, :gsisk)',
      ExpressionAttributeValues: { ':gsipk': { S: 'rel::y' }, ':gsisk': { S: 'geozone::' } },
    }, null, null, true);
  });

  it('wraps query failures as 400s', async () => {
    runQuery.mockRejectedValue(new Error('boom'));
    await expect(rel.getRelationshipsByPk('rel::x')).rejects.toMatchObject({ code: 400, message: 'Error getting Relationships' });
    await expect(rel.getRelationshipsByGsipk('rel::y')).rejects.toMatchObject({ code: 400, message: 'Error getting Relationships via GSI' });
  });
});

describe('filterExpandedEntitiesByRole', () => {
  const items = [
    { pk: 'r1', entity: { pk: 'activity::bcparks_1', sk: 'a', adminNotes: 'n1' } },
    { pk: 'r2', entity: { pk: 'facility::bcparks_2', sk: 'f', collectionId: 'bcparks_9', adminNotes: 'n2' } },
    { pk: 'r3', entity: null },
  ];

  it('returns everything to a superadmin', () => {
    expect(rel.filterExpandedEntitiesByRole(items, { superadmin: 'superadmin' })).toBe(items);
  });

  it('strips adminNotes from entities outside the caller collections, using collectionId over the pk', () => {
    const out = rel.filterExpandedEntitiesByRole(items, { bcparks_1: 'staff', bcparks_2: 'staff' });
    expect(out[0].entity.adminNotes).toBe('n1');
    expect(out[1].entity).toEqual({ pk: 'facility::bcparks_2', sk: 'f', collectionId: 'bcparks_9' });
    expect(out[2]).toEqual({ pk: 'r3', entity: null });
  });

  it('strips everything for a caller with no permissions', () => {
    const out = rel.filterExpandedEntitiesByRole(items, undefined);
    expect(out.filter((i) => i.entity?.adminNotes)).toEqual([]);
  });
});
