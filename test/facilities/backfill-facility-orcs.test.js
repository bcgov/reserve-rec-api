'use strict';

const { FACILITY_ORCS, planFacility, auditRecord } = require('../../src/scripts/tools/dynamodb/backfill-facility-orcs');

describe('backfill-facility-orcs', () => {
  it('covers the 10 facilities in #678', () => {
    const byOrcs = FACILITY_ORCS.reduce((acc, [, , orcs]) => ({ ...acc, [orcs]: (acc[orcs] || 0) + 1 }), {});
    expect(byOrcs).toEqual({ 7: 3, 8: 4, 15: 2, 363: 1 });
    expect(new Set(FACILITY_ORCS.map(([pk, sk]) => `${pk}::${sk}`)).size).toBe(10);
  });

  it('sets a facility without orcs or with a different one, and skips the rest', () => {
    expect(planFacility(undefined, 7)).toBe('missing');
    expect(planFacility({ displayName: 'Cheakamus' }, 7)).toBe('set');
    expect(planFacility({ orcs: 8 }, 7)).toBe('set');
    expect(planFacility({ orcs: 7 }, 7)).toBe('unchanged');
  });

  it('writes the same audit entry shape as the facility API', () => {
    expect(auditRecord('me', 'facility::bcparks_7', 'structure::1', null, 7, 'T')).toEqual({
      pk: 'me', sk: 'T', gsipk: 'entity::facility::bcparks_7::structure::1', gsisk: 'T', operation: 'FACILITY-ORCS-UPDATE',
      metadata: { entityId: 'facility::bcparks_7::structure::1', oldOrcs: null, newOrcs: 7, source: 'backfill-facility-orcs', timestamp: 'T' },
    });
  });
});
