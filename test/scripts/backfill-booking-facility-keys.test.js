'use strict';

const { applyBackfill, backfill } = require('../../src/scripts/migrations/backfill-booking-facility-keys');

const TABLES = { transactional: 'tx', reference: 'ref', relationshipIndex: 'entityRelationship-index' };

const booking = (id, activityId = '3', extra = {}) => ({
  pk: `booking::bcparks_1::backcountryCamp::${activityId}::4`, sk: `2026-06-15::${id}`,
  schema: 'booking', collectionId: 'bcparks_1', activityType: 'backcountryCamp', activityId, ...extra,
});
const facilityLink = (activityId, pk1, sk1) => ({ gsipk: `rel::activity::bcparks_1::backcountryCamp::${activityId}`, pk1, sk1 });

// Document-client stand-in for the commands the script sends. Update honours the
// script's own condition only if it states it, so dropping the condition shows up as an overwrite.
function fakeDocClient({ bookings = [], links = [] }) {
  const rows = new Map(bookings.map((item) => [`${item.pk}|${item.sk}`, { ...item }]));
  const updates = [];

  async function send(command) {
    const { input } = command;
    switch (command.constructor.name) {
      case 'ScanCommand':
        expect(input).toMatchObject({ TableName: 'tx', FilterExpression: '#schema = :booking AND attribute_not_exists(facilityKeys)' });
        return { Items: [...rows.values()].filter((row) => row.schema === 'booking' && !('facilityKeys' in row)) };
      case 'QueryCommand':
        expect(input).toMatchObject({ TableName: 'ref', IndexName: 'entityRelationship-index' });
        expect(input.ExpressionAttributeValues[':facility']).toBe('facility::');
        return { Items: links.filter((link) => link.gsipk === input.ExpressionAttributeValues[':gsipk']) };
      case 'UpdateCommand': {
        updates.push(input);
        const row = rows.get(`${input.Key.pk}|${input.Key.sk}`);
        if (input.ConditionExpression?.includes('attribute_not_exists(facilityKeys)') && 'facilityKeys' in row) {
          throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
        }
        row.facilityKeys = input.ExpressionAttributeValues[':facilityKeys'];
        return {};
      }
      default:
        throw new Error(`unsupported ${command.constructor.name}`);
    }
  }

  return { send, updates, row: (item) => rows.get(`${item.pk}|${item.sk}`) };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('backfill-booking-facility-keys', () => {
  it('dry run plans each booking with its facility key, collection from the link pk1, and writes nothing', async () => {
    const docClient = fakeDocClient({
      bookings: [booking('a'), booking('b'), booking('c', '5'), booking('done', '3', { facilityKeys: ['x'] })],
      links: [
        facilityLink('3', 'facility::bcparks_9', 'campground::2'),
        facilityLink('5', 'facility::bcparks_1', 'trail::1'),
        facilityLink('5', 'geozone::bcparks_1', '7'),
      ],
    });

    const result = await backfill({ docClient, dryRun: true, tables: TABLES });

    expect(result).toEqual({ planned: 3, set: 0, alreadySet: 0 });
    expect(docClient.updates).toEqual([]);
    expect(console.log).toHaveBeenCalledWith('  bcparks_1::backcountryCamp::3 -> bcparks_9::campground::2: 2 booking(s)');
    expect(console.log).toHaveBeenCalledWith('  bcparks_1::backcountryCamp::5 -> bcparks_1::trail::1: 1 booking(s)');
  });

  it('stops before any write when an activity has several facility links, even with --execute', async () => {
    const docClient = fakeDocClient({
      bookings: [booking('a'), booking('c', '5')],
      links: [
        facilityLink('3', 'facility::bcparks_1', 'campground::2'),
        facilityLink('5', 'facility::bcparks_1', 'trail::1'),
        facilityLink('5', 'facility::bcparks_1', 'trail::2'),
      ],
    });

    await expect(backfill({ docClient, dryRun: false, tables: TABLES })).rejects.toThrow('Stopped before any write');
    expect(docClient.updates).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/bcparks_1::backcountryCamp::5: 2 facility links/));
  });

  it('plans an activity without a facility link as [], writes it with --execute, and a rerun finds nothing to do', async () => {
    const docClient = fakeDocClient({
      bookings: [booking('a'), booking('c', '5')],
      links: [facilityLink('3', 'facility::bcparks_1', 'campground::2'), facilityLink('5', 'geozone::bcparks_1', '7')],
    });

    await expect(backfill({ docClient, dryRun: true, tables: TABLES })).resolves.toEqual({ planned: 2, set: 0, alreadySet: 0 });
    expect(docClient.updates).toEqual([]);
    expect(console.log).toHaveBeenCalledWith('  bcparks_1::backcountryCamp::5 -> [] (no facility link): 1 booking(s)');

    await expect(backfill({ docClient, dryRun: false, tables: TABLES })).resolves.toEqual({ planned: 2, set: 2, alreadySet: 0 });
    expect(docClient.row(booking('c', '5')).facilityKeys).toEqual([]);
    expect(docClient.row(booking('a')).facilityKeys).toEqual(['bcparks_1::campground::2']);

    await expect(backfill({ docClient, dryRun: false, tables: TABLES })).resolves.toEqual({ planned: 0, set: 0, alreadySet: 0 });
    expect(docClient.updates).toHaveLength(2);
  });

  it('stops on a booking without its activity fields', async () => {
    const docClient = fakeDocClient({ bookings: [booking('a', '3', { activityId: undefined })] });
    await expect(backfill({ docClient, dryRun: false, tables: TABLES })).rejects.toThrow('Stopped before any write');
    expect(docClient.updates).toEqual([]);
  });

  it('writes the keys with --execute, verifies, and a rerun finds nothing to do', async () => {
    const docClient = fakeDocClient({
      bookings: [booking('a'), booking('b')],
      links: [facilityLink('3', 'facility::bcparks_1', 'campground::2')],
    });

    await expect(backfill({ docClient, dryRun: false, tables: TABLES })).resolves.toEqual({ planned: 2, set: 2, alreadySet: 0 });
    expect(docClient.row(booking('a')).facilityKeys).toEqual(['bcparks_1::campground::2']);
    expect(docClient.row(booking('b')).facilityKeys).toEqual(['bcparks_1::campground::2']);

    await expect(backfill({ docClient, dryRun: false, tables: TABLES })).resolves.toEqual({ planned: 0, set: 0, alreadySet: 0 });
    expect(docClient.updates).toHaveLength(2);
  });

  it('leaves a booking that gained facilityKeys after the plan untouched', async () => {
    const created = booking('a', '3', { facilityKeys: ['bcparks_1::campground::7'] });
    const docClient = fakeDocClient({ bookings: [created] });

    const counts = await applyBackfill(docClient, [{ pk: created.pk, sk: created.sk, facilityKeys: ['bcparks_1::campground::2'] }], TABLES);

    expect(counts).toEqual({ set: 0, alreadySet: 1 });
    expect(docClient.row(created).facilityKeys).toEqual(['bcparks_1::campground::7']);
  });
});
