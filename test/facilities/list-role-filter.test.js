'use strict';

jest.mock('/opt/dynamodb', () => ({
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
  batchGetData: jest.fn(),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  marshall: jest.fn((x) => x),
  incrementCounter: jest.fn(),
  excludeDeletedItems: jest.fn((q) => q),
  excludeHiddenItems: jest.fn((q) => q),
  addFilters: jest.fn((q) => q),
}));

jest.mock('../../src/common/relationship-utils', () => ({
  getRelationshipsByGsipk: jest.fn(),
  expandRelationships: jest.fn(),
}));

const { runQuery } = require('/opt/dynamodb');
const { fetchFacilities } = require('../../src/handlers/facilities/methods');

const row = (sk) => ({ pk: 'facility::bcparks_1', sk, displayName: sk, adminNotes: 'gate code', version: 3 });

describe('fetchFacilities list role filtering', () => {
  beforeEach(() => {
    runQuery.mockResolvedValue({ items: [row('campground::1'), row('campground::2')], lastEvaluatedKey: { pk: 'x' } });
  });

  it('strips adminNotes from every listed facility for a public caller', async () => {
    const res = await fetchFacilities('bcparks_1', undefined, undefined, {}, { permissions: {} });

    expect(res.items).toHaveLength(2);
    res.items.forEach((item) => {
      expect(item).not.toHaveProperty('adminNotes');
      expect(item).not.toHaveProperty('version');
    });
    expect(res.lastEvaluatedKey).toEqual({ pk: 'x' });
  });

  it('keeps adminNotes for a superadmin', async () => {
    const res = await fetchFacilities('bcparks_1', undefined, undefined, {}, { permissions: { superadmin: 'superadmin' } });

    expect(res.items[0].adminNotes).toBe('gate code');
  });
});
