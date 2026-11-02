'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
}));

const { getOne, runQuery, batchGetData } = require('/opt/dynamodb');
const {
  buildCompKeysFromSkField,
  getAndAttachNestedProperties,
  getNextIdentifier,
  formatForQuickApi,
  formatProjectionsForQuery,
  quickApiPutHandler,
  quickApiUpdateHandler,
  resolveTemporalAnchor,
  resolveTemporalWindow,
} = require('../../src/common/data-utils');

const NOW = '2026-10-30T12:00:00.000Z';
const KEY = { pk: 'geozone::bcparks_1', sk: '1' };
const MARSHALLED_KEY = { pk: { S: 'geozone::bcparks_1' }, sk: { S: '1' } };
const stringRule = ({ value }) => {
  if (typeof value !== 'string') throw new Error('not a string');
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('quickApiUpdateHandler', () => {
  it('builds one SET/REMOVE expression from set, add, append and remove fields plus auto timestamp and version', async () => {
    const [cmd] = await quickApiUpdateHandler('RefTable', [{
      key: KEY,
      data: {
        displayName: 'Lot A',
        visits: { value: 2, action: 'add' },
        tags: { value: ['x'], action: 'append' },
        oldField: { value: 'gone', action: 'remove' },
      },
    }], { autoTimestamp: true, autoVersion: true });

    expect(cmd).toEqual({
      action: 'Update',
      data: {
        TableName: 'RefTable',
        Key: MARSHALLED_KEY,
        UpdateExpression:
          'SET #displayName = :displayName, #lastUpdated = :lastUpdated,' +
          ' #visits = if_not_exists(#visits, :add__start__value) + :visits,' +
          ' #version = if_not_exists(#version, :add__start__value) + :version,' +
          ' #tags = list_append(if_not_exists(#tags, :append__start__value), :tags)' +
          ' REMOVE #oldField',
        ExpressionAttributeNames: {
          '#displayName': 'displayName',
          '#lastUpdated': 'lastUpdated',
          '#visits': 'visits',
          '#version': 'version',
          '#tags': 'tags',
          '#oldField': 'oldField',
        },
        ExpressionAttributeValues: {
          ':displayName': { S: 'Lot A' },
          ':lastUpdated': { S: NOW },
          ':add__start__value': { N: '0' },
          ':visits': { N: '2' },
          ':version': { N: '1' },
          ':append__start__value': { L: [] },
          ':tags': { L: [{ S: 'x' }] },
        },
        ConditionExpression: 'attribute_exists(pk)',
      },
    });
  });

  it('omits ExpressionAttributeValues for a remove-only update', async () => {
    const [cmd] = await quickApiUpdateHandler('RefTable', [{
      key: KEY,
      data: { a: { action: 'remove' } },
    }], {});
    expect(cmd.data.UpdateExpression).toBe('REMOVE #a');
    expect(cmd.data).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('uses the condition expression from a per-item config over the call config', async () => {
    const [cmd] = await quickApiUpdateHandler('RefTable', [{
      key: KEY,
      data: { a: 1 },
      config: { conditionExpression: 'attribute_exists(sk)' },
    }], { conditionExpression: 'attribute_exists(pk) AND #x = :x' });
    expect(cmd.data.ConditionExpression).toBe('attribute_exists(sk)');
  });

  it.each([
    ['no key', { data: { a: 1 } }],
    ['key without sk', { key: { pk: 'p' }, data: { a: 1 } }],
    ['empty data', { key: KEY, data: {} }],
  ])('rejects with 400 on %s when failOnError is set', async (_label, item) => {
    await expect(quickApiUpdateHandler('RefTable', [item], { failOnError: true }))
      .rejects.toMatchObject({ code: 400 });
  });

  it('drops a bad item and keeps the good ones when failOnError is off', async () => {
    const cmds = await quickApiUpdateHandler('RefTable', [
      { key: { pk: 'p' }, data: { a: 1 } },
      { key: KEY, data: { a: 1 } },
    ], { failOnError: false });
    expect(cmds).toHaveLength(1);
    expect(cmds[0].data.Key).toEqual(MARSHALLED_KEY);
  });
});

describe('request validation (through quickApiUpdateHandler)', () => {
  const run = (data, fields, extra = {}) =>
    quickApiUpdateHandler('RefTable', [{ key: KEY, data }], { failOnError: true, fields, ...extra });

  it('rejects a missing mandatory field', async () => {
    await expect(run({ b: 'x' }, { a: { isMandatory: true }, b: {} }))
      .rejects.toMatchObject({ code: 400, message: "Mandatory field 'a' is missing in the request" });
  });

  it('rejects a field the config does not list', async () => {
    await expect(run({ rogue: 'x' }, { a: {} }))
      .rejects.toMatchObject({ code: 400, error: "Field 'rogue' is not allowed in the request" });
  });

  it('wraps a failing rule as a 400 naming the field', async () => {
    await expect(run({ a: 5 }, { a: { rulesFn: stringRule } }))
      .rejects.toMatchObject({ code: 400, message: "Validation failed for field 'a'" });
  });

  it('skips the rule for an empty value when allowEmpty is set', async () => {
    const nonEmptyRule = ({ value }) => {
      if (!value) throw new Error('empty');
    };
    await expect(run({ a: '' }, { a: { allowEmpty: true, rulesFn: nonEmptyRule } })).resolves.toHaveLength(1);
    await expect(run({ a: '' }, { a: { rulesFn: nonEmptyRule } })).rejects.toMatchObject({ code: 400 });
    await expect(run({ a: 0 }, { a: { allowEmpty: true, rulesFn: nonEmptyRule } })).rejects.toMatchObject({ code: 400 });
  });

  it('skips all validation in developerMode', async () => {
    await expect(run({ rogue: 5 }, { a: { isMandatory: true } }, { developerMode: true })).resolves.toHaveLength(1);
  });

  it('validates the fields of a nested object', async () => {
    const fields = { address: { fields: { city: { rulesFn: stringRule } } } };
    await expect(run({ address: { city: { value: 'Victoria', action: 'set' } } }, fields)).resolves.toHaveLength(1);
    await expect(run({ address: { city: { value: 7, action: 'set' } } }, fields))
      .rejects.toMatchObject({ message: "Validation failed for nested field in 'address'" });
  });

  it('validates each item of a nested array and names the failing index', async () => {
    const fields = { rooms: { fields: [{ name: { rulesFn: stringRule } }] } };
    const ok = { value: 'A', action: 'set' };
    const bad = { value: 1, action: 'set' };
    await expect(run({ rooms: [{ name: ok }] }, fields)).resolves.toHaveLength(1);
    await expect(run({ rooms: [{ name: ok }, { name: bad }] }, fields))
      .rejects.toMatchObject({ message: "Validation failed for nested array item with index [1] in 'rooms'" });
    await expect(run({ rooms: 'not-an-array' }, fields))
      .rejects.toMatchObject({ error: "Field 'rooms' should be an array" });
  });
});

describe('quickApiPutHandler', () => {
  const fields = { pk: {}, sk: {}, displayName: { rulesFn: stringRule } };

  it('builds a guarded Put with creation timestamps, version 1 and a globalId', async () => {
    const [cmd] = await quickApiPutHandler('RefTable', [{
      key: KEY,
      data: { pk: KEY.pk, sk: KEY.sk, displayName: 'Lot A' },
    }], { fields, autoTimestamp: true, autoVersion: true, autoGlobalId: true });

    expect(getOne).not.toHaveBeenCalled();
    expect(cmd.action).toBe('Put');
    expect(cmd.data.TableName).toBe('RefTable');
    expect(cmd.data.ConditionExpression).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)');
    expect(cmd.data.Item).toEqual({
      pk: { S: KEY.pk },
      sk: { S: KEY.sk },
      displayName: { S: 'Lot A' },
      creationDate: { S: NOW },
      lastUpdated: { S: NOW },
      version: { N: '1' },
      globalId: { S: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) },
    });
  });

  it('on allowOverwrite keeps the stored creationDate, bumps the version and drops the guard', async () => {
    getOne.mockResolvedValue({ creationDate: '2026-01-01T00:00:00.000Z', version: 4 });
    const [cmd] = await quickApiPutHandler('RefTable', [{
      key: KEY,
      data: { pk: KEY.pk, sk: KEY.sk, displayName: 'Lot A' },
    }], { fields, autoTimestamp: true, autoVersion: true, allowOverwrite: true });

    expect(getOne).toHaveBeenCalledWith(KEY.pk, KEY.sk);
    expect(cmd.data).not.toHaveProperty('ConditionExpression');
    expect(cmd.data.Item.creationDate).toEqual({ S: '2026-01-01T00:00:00.000Z' });
    expect(cmd.data.Item.lastUpdated).toEqual({ S: NOW });
    expect(cmd.data.Item.version).toEqual({ N: '5' });
  });

  it('validates nested objects and arrays of objects in the plain item shape', async () => {
    const nested = {
      pk: {}, sk: {},
      rooms: { fields: [{ name: { rulesFn: stringRule } }] },
      address: { fields: { city: { rulesFn: stringRule } } },
    };
    const put = (data) => quickApiPutHandler('RefTable', [{ key: KEY, data: { pk: 'p', sk: 's', ...data } }], { fields: nested, failOnError: true });

    await expect(put({ rooms: [{ name: 'A' }], address: { city: 'Victoria' } })).resolves.toHaveLength(1);
    await expect(put({ rooms: [{ name: 'A' }, { name: 2 }] }))
      .rejects.toMatchObject({ message: "Validation failed for nested array item with index [1] in 'rooms'" });
    await expect(put({ address: { city: 9 } }))
      .rejects.toMatchObject({ message: "Validation failed for nested field in 'address'" });
  });

  it('rejects empty data with failOnError and skips it without', async () => {
    await expect(quickApiPutHandler('RefTable', [{ key: KEY, data: {} }], { fields, failOnError: true }))
      .rejects.toMatchObject({ code: 400 });
    await expect(quickApiPutHandler('RefTable', [{ key: KEY, data: {} }], { fields })).resolves.toEqual([]);
  });
});

describe('getNextIdentifier', () => {
  it('returns one more than the highest numeric identifier under the pk and sk prefix', async () => {
    runQuery.mockResolvedValue({ items: [{ identifier: '3' }, { identifier: '10' }, { identifier: '7' }] });
    await expect(getNextIdentifier('RefTable', 'facility::bcparks_1', 'identifier', 'campground::')).resolves.toBe(11);
    expect(runQuery).toHaveBeenCalledWith({
      TableName: 'RefTable',
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': { S: 'facility::bcparks_1' }, ':sk': { S: 'campground::' } },
    }, null, null, false);
  });

  it('starts at 1 when nothing exists yet', async () => {
    runQuery.mockResolvedValue({ items: [] });
    await expect(getNextIdentifier('RefTable', 'facility::bcparks_1', 'identifier')).resolves.toBe(1);
    expect(runQuery.mock.calls[0][0].KeyConditionExpression).toBe('pk = :pk');
  });
});

describe('small formatters', () => {
  it('buildCompKeysFromSkField pairs each sk with a fixed or derived pk', () => {
    const root = { collectionId: 'bcparks_1', skList: ['a', 'b'] };
    expect(buildCompKeysFromSkField(root, 'fixed', 'skList')).toEqual([{ pk: 'fixed', sk: 'a' }, { pk: 'fixed', sk: 'b' }]);
    expect(buildCompKeysFromSkField(root, (r) => `x::${r.collectionId}`, 'skList'))
      .toEqual([{ pk: 'x::bcparks_1', sk: 'a' }, { pk: 'x::bcparks_1', sk: 'b' }]);
  });

  it('formatForQuickApi wraps one item or many as key/data pairs', () => {
    const item = { pk: 'p', sk: 's', v: 1 };
    expect(formatForQuickApi(item)).toEqual([{ key: { pk: 'p', sk: 's' }, data: item }]);
    expect(formatForQuickApi([item, item])).toHaveLength(2);
  });

  it('formatProjectionsForQuery maps names to #placeholders, or null when empty', () => {
    expect(formatProjectionsForQuery(['pk', 'displayName'])).toEqual({ '#pk': 'pk', '#displayName': 'displayName' });
    expect(formatProjectionsForQuery([])).toBeNull();
    expect(formatProjectionsForQuery(undefined)).toBeNull();
  });
});

describe('getAndAttachNestedProperties', () => {
  it('replaces key arrays with fetched items and a single key with its item', async () => {
    batchGetData
      .mockResolvedValueOnce([{ pk: 'f', sk: '1', name: 'F1' }, { pk: 'f', sk: '2', name: 'F2' }])
      .mockResolvedValueOnce([{ pk: 'g', sk: '1', name: 'G1' }]);
    const item = { facilities: [{ pk: 'f', sk: '1' }, { pk: 'f', sk: '2' }], geozone: { pk: 'g', sk: '1' }, empty: [] };

    await getAndAttachNestedProperties(item, ['facilities', 'geozone', 'empty', 'absent']);

    expect(batchGetData).toHaveBeenNthCalledWith(1, [{ pk: 'f', sk: '1' }, { pk: 'f', sk: '2' }], 'reference-data');
    expect(batchGetData).toHaveBeenNthCalledWith(2, [{ pk: 'g', sk: '1' }], 'reference-data');
    expect(item.facilities.map((f) => f.name)).toEqual(['F1', 'F2']);
    expect(item.geozone.name).toBe('G1');
    expect(item.empty).toEqual([]);
  });

  it('400s when properties is not an array', async () => {
    await expect(getAndAttachNestedProperties({ a: 1 }, 'a')).rejects.toMatchObject({ code: 400 });
  });

  it('400s naming the property when the fetch fails', async () => {
    batchGetData.mockRejectedValue(new Error('throttled'));
    await expect(getAndAttachNestedProperties({ geozone: { pk: 'g', sk: '1' } }, ['geozone']))
      .rejects.toMatchObject({ code: 400, message: "Failure getting nested property 'geozone'." });
  });
});

describe('resolveTemporalAnchor', () => {
  const TZ = 'America/Vancouver';

  it('shifts a fixed date back by default and forward when asked', () => {
    expect(resolveTemporalAnchor({ id: 'a', fixedDateTime: '2026-07-10', duration: { days: 3 } }, TZ).ts).toBe('2026-07-07');
    expect(resolveTemporalAnchor({ id: 'a', fixedDateTime: '2026-07-10', duration: { days: 3, direction: 'after' } }, TZ).ts).toBe('2026-07-13');
  });

  it('keeps the input time in the park timezone when keepInputTime is set', () => {
    const r = resolveTemporalAnchor({ id: 'a', fixedDateTime: '2026-07-01T09:30:00', keepInputTime: true }, TZ);
    expect(r.ts).toBe('2026-07-01T09:30:00.000-07:00');
    expect(r.millis).toBe(Date.UTC(2026, 6, 1, 16, 30));
  });

  it('resolves a dotted anchorRef from the ref store and records its own result', () => {
    const refStore = { booking: { start: '2026-08-20T15:00:00Z' } };
    const r = resolveTemporalAnchor({ id: 'checkIn', anchorRef: 'booking.start', timeOfDay: { hour: 14, minute: 0, second: 0 } }, TZ, refStore);
    expect(r.ts).toBe('2026-08-20T14:00:00.000-07:00');
    expect(refStore.checkIn).toBe('2026-08-20T14:00:00.000-07:00');
  });

  it('normalises an epoch anchorRef to the park-local calendar date', () => {
    // 05:00 UTC is still the previous evening in Vancouver
    const r = resolveTemporalAnchor({ id: 'a', anchorRef: 'when' }, TZ, { when: Date.UTC(2026, 6, 2, 5, 0) });
    expect(r.ts).toBe('2026-07-01');
  });

  it('400s when neither a resolvable anchorRef nor fixedDateTime is given', () => {
    expect(() => resolveTemporalAnchor({ id: 'a', anchorRef: 'missing.path' }, TZ, {})).toThrow(expect.objectContaining({ code: 400 }));
    expect(() => resolveTemporalAnchor({ id: 'a' }, TZ)).toThrow(expect.objectContaining({ code: 400 }));
  });
});

describe('resolveTemporalWindow', () => {
  it('lets a later window anchor on an earlier window stored in the ref store', () => {
    const TZ = 'America/Vancouver';
    const refStore = {};
    const first = resolveTemporalWindow({
      id: 'season', label: 'Season',
      open: { id: 'seasonOpen', fixedDateTime: '2026-06-01T08:00:00', keepInputTime: true },
      close: { id: 'seasonClose', fixedDateTime: '2026-09-30T20:00:00', keepInputTime: true },
    }, TZ, refStore);
    const second = resolveTemporalWindow({
      id: 'early',
      open: { id: 'earlyOpen', anchorRef: 'season.ts.open', duration: { days: 7 }, timeOfDay: { hour: 7, minute: 0, second: 0 } },
      close: { id: 'earlyClose', anchorRef: 'season.ts.open', keepInputTime: true },
    }, TZ, refStore);

    expect(first).toMatchObject({ id: 'season', label: 'Season', open: Date.UTC(2026, 5, 1, 15, 0), close: Date.UTC(2026, 9, 1, 3, 0) });
    expect(refStore.season.ts.open).toBe('2026-06-01T08:00:00.000-07:00');
    expect(second.ts).toEqual({ open: '2026-05-25T07:00:00.000-07:00', close: '2026-06-01T08:00:00.000-07:00' });
    expect(second.open).toBe(Date.UTC(2026, 4, 25, 14, 0));
  });
});
