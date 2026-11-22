'use strict';

const {
  adminContext,
  requireRole,
  checkFacilityScope,
  checkRequestedFacilityKeys,
  permittedFacilityKeys,
  checkAuthContext,
  MAX_REQUESTED_FACILITY_KEYS,
} = require('../src/layers/base/base');

const K7A = 'bcparks_7::structure::1';
const K7B = 'bcparks_7::structure::2';
const K8 = 'bcparks_8::trail::1';
const K9 = 'bcparks_9::campground::4';

const event = (authorizer) => ({ requestContext: { authorizer } });
const ALL = JSON.stringify({ superadmin: 'superadmin' });

const superadmin = () => event({ role: 'superadmin', isAdmin: 'true', permissions: ALL, principalId: 'sa' });
const hqAdmin = () => event({ role: 'hqAdmin', permissions: ALL, principalId: 'hq' });
const operator = () => event({ role: 'parkOperator', operatorId: 'op-1', permissions: '{}', facilities: JSON.stringify([K7A, K7B, K8]) });
const staff = () => event({ role: 'parkStaff', operatorId: 'op-1', permissions: '{}', facilities: JSON.stringify([K7A]) });
// A record without `role`: the old per-collection tier map.
const legacy = () => event({ permissions: JSON.stringify({ bcparks_7: 'staff', bcparks_8: 'limited' }) });

const refused = (fn, code) => {
  let error;
  try { fn(); } catch (e) { error = e; }
  expect(error).toBeDefined();
  expect(error.code).toBe(code);
};

describe('adminContext', () => {
  it('parses the authorizer context once into role, permissions and facilities', () => {
    expect(adminContext(operator())).toMatchObject({ role: 'parkOperator', permissions: {}, facilities: [K7A, K7B, K8] });
    expect(adminContext(legacy())).toMatchObject({ role: null, facilities: null });
  });

  it.each([
    ['not JSON', 'not-json'],
    ['not a list', JSON.stringify({ k: K7A })],
    ['a list with a non-string', JSON.stringify([K7A, 7])],
  ])('refuses a scoped caller whose facilities are %s', (_, facilities) => {
    refused(() => adminContext(event({ role: 'parkStaff', permissions: '{}', facilities })), 401);
  });

  it('refuses a scoped caller with no facilities in the context', () => {
    refused(() => adminContext(event({ role: 'parkStaff', permissions: '{}' })), 401);
  });
});

describe('requireRole', () => {
  it('passes a caller at or above the role and refuses one below it', () => {
    expect(() => requireRole(staff(), 'parkStaff')).not.toThrow();
    refused(() => requireRole(staff(), 'parkOperator'), 403);
    expect(() => requireRole(hqAdmin(), 'parkOperator')).not.toThrow();
    refused(() => requireRole(hqAdmin(), 'superadmin'), 403);
    expect(() => requireRole(superadmin(), 'superadmin')).not.toThrow();
  });

  it('refuses a caller with no role', () => {
    refused(() => requireRole(legacy(), 'parkStaff'), 403);
  });
});

describe('permittedFacilityKeys', () => {
  it('is null only for all-access callers, an array for everyone else', () => {
    expect(permittedFacilityKeys(adminContext(superadmin()))).toBeNull();
    expect(permittedFacilityKeys(adminContext(hqAdmin()))).toBeNull();
    expect(permittedFacilityKeys(adminContext(staff()))).toEqual([K7A]);
    expect(permittedFacilityKeys(adminContext(legacy()))).toEqual([]);
  });
});

describe('checkFacilityScope', () => {
  it('passes a scoped caller when any of the record keys is in scope', () => {
    expect(() => checkFacilityScope(staff(), 'parkStaff', [K9, K7A])).not.toThrow();
    refused(() => checkFacilityScope(staff(), 'parkStaff', [K9]), 403);
  });

  it('refuses a scoped caller below the role even for a key in scope', () => {
    refused(() => checkFacilityScope(staff(), 'parkOperator', [K7A]), 403);
  });

  it('passes all-access callers for any keys', () => {
    expect(() => checkFacilityScope(hqAdmin(), 'parkOperator', [K9])).not.toThrow();
    expect(() => checkFacilityScope(superadmin(), 'hqAdmin', [K9])).not.toThrow();
  });

  it.each([[undefined], [[]], ['bcparks_7::structure::1']])('refuses a record key list of %p', (keys) => {
    refused(() => checkFacilityScope(superadmin(), 'parkStaff', keys), 403);
  });

  it('needs the legacy tier, by rank, in the collection of every key', () => {
    expect(() => checkFacilityScope(legacy(), 'parkStaff', [K7A, K8])).not.toThrow(); // staff, limited
    expect(() => checkFacilityScope(legacy(), 'parkOperator', [K7A])).not.toThrow(); // staff
    refused(() => checkFacilityScope(legacy(), 'parkOperator', [K7A, K8]), 403); // limited is below parkOperator
    refused(() => checkFacilityScope(legacy(), 'parkStaff', [K7A, K9]), 403); // no tier in bcparks_9
    refused(() => checkFacilityScope(legacy(), 'hqAdmin', [K7A]), 403); // no tier reaches hqAdmin
  });
});

describe('checkRequestedFacilityKeys', () => {
  it('passes when every requested key is in scope', () => {
    expect(() => checkRequestedFacilityKeys(operator(), 'parkOperator', [K7A, K8])).not.toThrow();
    expect(() => checkRequestedFacilityKeys(superadmin(), 'parkOperator', [K9])).not.toThrow();
  });

  it('refuses with 403 when any requested key is out of scope', () => {
    refused(() => checkRequestedFacilityKeys(operator(), 'parkOperator', [K7A, K9]), 403);
  });

  it.each([
    ['not a list', K7A],
    ['empty', []],
    ['too long', Array(MAX_REQUESTED_FACILITY_KEYS + 1).fill(K7A)],
    ['a malformed key', [K7A, 'bcparks_7']],
    ['a key with an empty part', ['bcparks_7::::1']],
    ['a non-string entry', [K7A, 7]],
  ])('refuses with 400 a list that is %s', (_, keys) => {
    refused(() => checkRequestedFacilityKeys(superadmin(), 'parkStaff', keys), 400);
  });

  it('refuses a caller below the role', () => {
    refused(() => checkRequestedFacilityKeys(staff(), 'parkOperator', [K7A]), 403);
  });

  it('needs the legacy tier, by rank, in the collection of every key', () => {
    expect(() => checkRequestedFacilityKeys(legacy(), 'parkStaff', [K7A, K8])).not.toThrow();
    refused(() => checkRequestedFacilityKeys(legacy(), 'parkOperator', [K8]), 403);
  });
});

describe('checkAuthContext with a scoped role', () => {
  it.each(['parkStaff', 'parkOperator'])('refuses %s whatever its arguments', (role) => {
    const e = event({ role, permissions: '{}', facilities: JSON.stringify([K7A]) });
    refused(() => checkAuthContext(e), 403);
    refused(() => checkAuthContext(e, 'limited', 'bcparks_7'), 403);
  });

  it('still lets HQ Admin and Superadmin through', () => {
    expect(() => checkAuthContext(hqAdmin(), 'staff', 'bcparks_7')).not.toThrow();
    expect(() => checkAuthContext(superadmin())).not.toThrow();
  });
});
