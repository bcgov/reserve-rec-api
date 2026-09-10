'use strict';

// Unit tests for the facility duplicate-name guard and the paginated flag
// (bcgov/reserve-rec-admin#392, review on bcgov/reserve-rec-api#519).

jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  filterByRole: jest.fn((x) => x),
  effectiveCollectionRole: jest.fn(),
}));

jest.mock('/opt/dynamodb', () => ({
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
  batchGetData: jest.fn(),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  marshall: jest.fn((x) => x),
  incrementCounter: jest.fn(),
  excludeDeletedItems: jest.fn((q) => q),
}));

jest.mock('../../src/common/relationship-utils', () => ({
  getRelationshipsByGsipk: jest.fn(),
  expandRelationships: jest.fn(),
}));

const { runQuery } = require('/opt/dynamodb');
const {
  assertFacilityNamesAvailable,
  getFacilitiesByCollectionId,
} = require('../../src/handlers/facilities/methods');

const existing = (names) => ({
  items: names.map(([displayName, sk]) => ({ displayName, sk })),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isPaginated (via getFacilitiesByCollectionId)', () => {
  const paginatedArg = () => runQuery.mock.calls[0][3];

  it.each([
    ['undefined params', undefined, true],
    ['empty object', {}, true],
    ['empty string value', { paginated: '' }, true],
    ['string "false"', { paginated: 'false' }, false],
    ['boolean false', { paginated: false }, false],
    ['boolean true', { paginated: true }, true],
  ])('%s -> paginated=%s', async (_label, params, expected) => {
    runQuery.mockResolvedValue({ items: [] });
    await getFacilitiesByCollectionId('park-1', {}, params);
    expect(paginatedArg()).toBe(expected);
  });
});

describe('assertFacilityNamesAvailable', () => {
  it('fetches every page of existing facilities (paginated: false)', async () => {
    runQuery.mockResolvedValue(existing([]));
    await assertFacilityNamesAvailable('park-1', [{ displayName: 'Lot B' }]);
    expect(runQuery.mock.calls[0][3]).toBe(false);
  });

  it('409s on a name already used in the park, case/space-insensitive', async () => {
    runQuery.mockResolvedValue(existing([['Lot A', 'parkingLot::1']]));
    await expect(
      assertFacilityNamesAvailable('park-1', [{ displayName: '  lot a  ' }]),
    ).rejects.toMatchObject({ code: 409 });
  });

  it('keeps the caller casing in the 409 message', async () => {
    runQuery.mockResolvedValue(existing([['Lot A', 'parkingLot::1']]));
    await expect(
      assertFacilityNamesAvailable('park-1', [{ displayName: 'LOT A' }]),
    ).rejects.toMatchObject({ message: expect.stringContaining('"LOT A"') });
  });

  it('409s when the request repeats a name against itself', async () => {
    await expect(
      assertFacilityNamesAvailable('park-1', [
        { displayName: 'New Lot' },
        { displayName: 'new lot' },
      ]),
    ).rejects.toMatchObject({ code: 409 });
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('lets a rename keep the same name on the same facility (self not a conflict)', async () => {
    runQuery.mockResolvedValue(existing([['Lot A', 'parkingLot::1']]));
    await expect(
      assertFacilityNamesAvailable('park-1', [
        { displayName: 'Lot A', sk: 'parkingLot::1' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('409s when a rename collides with a different facility', async () => {
    runQuery.mockResolvedValue(
      existing([
        ['Lot A', 'parkingLot::1'],
        ['Lot B', 'parkingLot::2'],
      ]),
    );
    await expect(
      assertFacilityNamesAvailable('park-1', [
        { displayName: 'Lot A', sk: 'parkingLot::2' },
      ]),
    ).rejects.toMatchObject({ code: 409 });
  });

  it('allows a unique name', async () => {
    runQuery.mockResolvedValue(existing([['Lot A', 'parkingLot::1']]));
    await expect(
      assertFacilityNamesAvailable('park-1', [{ displayName: 'Lot C' }]),
    ).resolves.toBeUndefined();
  });

  it('no-op when no displayName is being set', async () => {
    await assertFacilityNamesAvailable('park-1', [{ timezone: 'America/Vancouver' }]);
    expect(runQuery).not.toHaveBeenCalled();
  });
});
