'use strict';

const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  facilityKey, facilityItemKey, grantProblem, buildFacilities, sameFacilities, auditRecord, updateParams, rebuildOperator,
} = require('../../src/scripts/tools/dynamodb/rebuild-operator-facilities');

const TABLE = 'ref';
const OPTS = { tableName: TABLE, auditTableName: 'audit', auditUser: 'me', apply: true };
const fac = (col, sk, orcs, displayName) => ({ pk: `facility::${col}`, sk, orcs, displayName });

const CHEAKAMUS = fac('bcparks_7', 'structure::1', 7, 'Cheakamus');
const DIAMOND = fac('bcparks_7', 'structure::2', 7, 'Diamond Head');
const JOFFRE = fac('bcparks_363', 'trail::1', 363, 'Joffre Lakes');

// A fake DocumentClient: orcs-index queries answer from `byOrcs`, gets from `byKey`.
function fakeDoc({ byOrcs = {}, byKey = {} } = {}) {
  return {
    send: jest.fn(async (cmd) => {
      if (cmd.input.IndexName === 'orcs-index') return { Items: byOrcs[cmd.input.ExpressionAttributeValues[':orcs']] || [] };
      if (cmd instanceof GetCommand) return { Item: byKey[`${cmd.input.Key.pk}|${cmd.input.Key.sk}`] };
      return {};
    }),
  };
}
const writes = (doc) => doc.send.mock.calls.map(([c]) => c).filter((c) => c instanceof UpdateCommand || c instanceof PutCommand);
const silent = () => {};

describe('rebuild-operator-facilities', () => {
  it('converts between facility items and facility keys', () => {
    expect(facilityKey(CHEAKAMUS)).toBe('bcparks_7::structure::1');
    expect(facilityItemKey('bcparks_7::structure::1')).toEqual({ pk: 'facility::bcparks_7', sk: 'structure::1' });
  });

  it.each([
    [{ orcs: [7, 8] }, null],
    [{ orcs: [7], extraFacilities: ['bcparks_363::trail::1'] }, null],
    [{}, 'orcs is not a list of park numbers'],
    [{ orcs: ['7'] }, 'orcs is not a list of park numbers'],
    [{ orcs: [0] }, 'orcs is not a list of park numbers'],
    [{ orcs: [7], extraFacilities: ['bcparks_363'] }, 'extraFacilities is not a list of facility keys'],
    [{ orcs: [7], extraFacilities: 'bcparks_363::trail::1' }, 'extraFacilities is not a list of facility keys'],
  ])('checks the grant %j', (operator, problem) => {
    expect(grantProblem(operator)).toBe(problem);
  });

  it('builds the cache keyed by facility, and compares it in any key order', () => {
    const built = buildFacilities([DIAMOND, CHEAKAMUS]);
    expect(built).toEqual({
      'bcparks_7::structure::1': { orcs: 7, displayName: 'Cheakamus' },
      'bcparks_7::structure::2': { orcs: 7, displayName: 'Diamond Head' },
    });
    const reversed = Object.fromEntries(Object.entries(built).reverse());
    expect(sameFacilities(reversed, built)).toBe(true);
    expect(sameFacilities(undefined, built)).toBe(false);
    expect(sameFacilities(built, { ...built, 'bcparks_7::structure::2': { orcs: 7, displayName: 'Renamed' } })).toBe(false);
  });

  it('writes the same audit entry shape as writeAuditLog', () => {
    expect(auditRecord('me', 'op1', null, { k: 1 }, 'T', 'U')).toEqual({
      pk: 'me', sk: 'T#U', gsipk: 'entity::operator::op1', gsisk: 'T', operation: 'OPERATOR-FACILITIES-REBUILD',
      metadata: { entityId: 'operator::op1', oldFacilities: null, newFacilities: { k: 1 }, source: 'rebuild-operator-facilities', timestamp: 'T' },
    });
  });

  it('only writes when orcs and extras are still what it read', () => {
    const withExtras = updateParams(TABLE, { pk: 'operator::op1', sk: 'base', orcs: [7], extraFacilities: ['bcparks_363::trail::1'] }, {});
    expect(withExtras.ConditionExpression).toBe('#orcs = :orcs AND #extra = :extra');
    expect(withExtras.ExpressionAttributeValues[':builtFrom']).toEqual({ orcs: [7], extraFacilities: ['bcparks_363::trail::1'] });

    const noExtras = updateParams(TABLE, { pk: 'operator::op1', sk: 'base', orcs: [7] }, {});
    expect(noExtras.ConditionExpression).toBe('#orcs = :orcs AND attribute_not_exists(#extra)');
    expect(noExtras.ExpressionAttributeValues).not.toHaveProperty(':extra');
    expect(noExtras.UpdateExpression).toBe('SET #facilities = :facilities, #builtFrom = :builtFrom');
  });

  it('caches park facilities plus extras, then audits the change', async () => {
    const doc = fakeDoc({ byOrcs: { 7: [CHEAKAMUS, DIAMOND] }, byKey: { 'facility::bcparks_363|trail::1': JOFFRE } });
    const operator = { pk: 'operator::op1', sk: 'base', orcs: [7], extraFacilities: ['bcparks_363::trail::1'] };

    expect(await rebuildOperator(doc, OPTS, operator, silent)).toBe('updated');

    const [update, audit] = writes(doc);
    expect(Object.keys(update.input.ExpressionAttributeValues[':facilities'])).toEqual([
      'bcparks_363::trail::1', 'bcparks_7::structure::1', 'bcparks_7::structure::2',
    ]);
    expect(audit.input).toMatchObject({ TableName: 'audit', Item: { pk: 'me', operation: 'OPERATOR-FACILITIES-REBUILD', metadata: { oldFacilities: null } } });
  });

  it('leaves out non-facility items the index returns and extras that do not exist', async () => {
    const doc = fakeDoc({ byOrcs: { 7: [CHEAKAMUS, { pk: 'protectedArea', sk: '7', orcs: 7 }] } });
    const operator = { pk: 'operator::op1', sk: 'base', orcs: [7], extraFacilities: ['bcparks_9::trail::1'] };

    await rebuildOperator(doc, OPTS, operator, silent);

    expect(Object.keys(writes(doc)[0].input.ExpressionAttributeValues[':facilities'])).toEqual(['bcparks_7::structure::1']);
  });

  it('reads every page of a park from orcs-index', async () => {
    const doc = fakeDoc();
    doc.send.mockImplementation(async (cmd) => {
      if (!cmd.input.IndexName) return {};
      return cmd.input.ExclusiveStartKey ? { Items: [DIAMOND] } : { Items: [CHEAKAMUS], LastEvaluatedKey: { pk: 'x' } };
    });

    await rebuildOperator(doc, OPTS, { pk: 'operator::op1', sk: 'base', orcs: [7] }, silent);

    expect(Object.keys(writes(doc)[0].input.ExpressionAttributeValues[':facilities'])).toEqual(['bcparks_7::structure::1', 'bcparks_7::structure::2']);
  });

  it('writes nothing when the cache is unchanged', async () => {
    const doc = fakeDoc({ byOrcs: { 7: [CHEAKAMUS] } });
    const operator = {
      pk: 'operator::op1', sk: 'base', orcs: [7],
      facilities: buildFacilities([CHEAKAMUS]), facilitiesBuiltFrom: { orcs: [7], extraFacilities: [] },
    };

    expect(await rebuildOperator(doc, OPTS, operator, silent)).toBe('unchanged');
    expect(writes(doc)).toEqual([]);
  });

  it('rewrites when the grant changed even if the facilities did not', async () => {
    const doc = fakeDoc({ byOrcs: { 7: [CHEAKAMUS] } });
    const operator = {
      pk: 'operator::op1', sk: 'base', orcs: [7, 999],
      facilities: buildFacilities([CHEAKAMUS]), facilitiesBuiltFrom: { orcs: [7], extraFacilities: [] },
    };

    expect(await rebuildOperator(doc, OPTS, operator, silent)).toBe('updated');
    expect(writes(doc)[0].input.ExpressionAttributeValues[':builtFrom']).toEqual({ orcs: [7, 999], extraFacilities: [] });
  });

  it('writes nothing on a dry run', async () => {
    const doc = fakeDoc({ byOrcs: { 7: [CHEAKAMUS] } });

    expect(await rebuildOperator(doc, { ...OPTS, apply: false }, { pk: 'operator::op1', sk: 'base', orcs: [7] }, silent)).toBe('updated');
    expect(writes(doc)).toEqual([]);
  });

  it('skips an invalid operator without reading or writing anything', async () => {
    const doc = fakeDoc();

    expect(await rebuildOperator(doc, OPTS, { pk: 'operator::op1', sk: 'base', orcs: '7' }, silent)).toBe('invalid');
    expect(doc.send).not.toHaveBeenCalled();
  });

  it('writes no audit entry when the guarded update fails', async () => {
    const doc = fakeDoc({ byOrcs: { 7: [CHEAKAMUS] } });
    doc.send.mockImplementation(async (cmd) => {
      if (cmd instanceof UpdateCommand) throw Object.assign(new Error('changed'), { name: 'ConditionalCheckFailedException' });
      return cmd.input.IndexName ? { Items: [CHEAKAMUS] } : {};
    });

    await expect(rebuildOperator(doc, OPTS, { pk: 'operator::op1', sk: 'base', orcs: [7] }, silent)).rejects.toThrow('changed');
    expect(writes(doc).filter((c) => c instanceof PutCommand)).toEqual([]);
  });
});
