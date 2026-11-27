'use strict';

const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  getOne: (...args) => mockGetOne(...args),
  USER_ID_PARTITION: 'userid',
}));

const { resolveAdminPermissions } = require('../src/handlers/authorizers/admin-permissions');

const payload = (groups) => ({ sub: 'sub-1', 'cognito:groups': groups });
const SUPERADMIN = 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup';
const SUPER_PERMISSIONS = { superadmin: 'superadmin' };
const USERS_ME_ONLY = { isSuperAdmin: false, permissions: null };

const OPERATOR = {
  pk: 'operator::op-1',
  sk: 'base',
  parks: [7, 8],
  extraFacilities: ['bcparks_363::trail::9'],
  facilities: {
    'bcparks_7::structure::3': { orcs: 7, displayName: 'Hut' },
    'bcparks_7::campground::1': { orcs: 7, displayName: 'Camp' },
    'bcparks_8::lot::1': { orcs: 8, displayName: 'Lot' },
    'bcparks_363::trail::9': { orcs: 363, displayName: 'Trail' },
  },
};

// Serves the user record and the operator record by pk.
function records({ user, operator = OPERATOR }) {
  mockGetOne.mockImplementation(async (pk) => {
    if (pk === 'userid::sub-1') return user ?? null;
    if (pk === 'operator::op-1') return operator ?? null;
    return null;
  });
}

const scoped = (extra = {}) => ({ role: 'parkStaff', operatorId: 'op-1', ...extra });

describe('resolveAdminPermissions', () => {
  beforeEach(() => mockGetOne.mockReset());

  describe('groups', () => {
    it.each([
      ['the unauthorized group', ['unauthorized']],
      ['an empty group name', ['']],
      ['unauthorized alongside SuperAdmin', [SUPERADMIN, 'unauthorized']],
    ])('flags %s as unauthorized without a lookup', async (_, groups) => {
      await expect(resolveAdminPermissions(payload(groups))).resolves.toEqual({ unauthorized: true });
      expect(mockGetOne).not.toHaveBeenCalled();
    });

    it('denies the unauthorized group even with a role record', async () => {
      records({ user: { role: 'hqAdmin' } });
      await expect(resolveAdminPermissions(payload(['unauthorized']))).resolves.toEqual({ unauthorized: true });
    });

    it('grants superadmin to a SuperAdmin group member with no record', async () => {
      records({ user: null });
      await expect(resolveAdminPermissions(payload(['staff', SUPERADMIN]))).resolves.toEqual({
        isSuperAdmin: true,
        role: 'superadmin',
        permissions: SUPER_PERMISSIONS,
      });
      expect(mockGetOne).toHaveBeenCalledWith('userid::sub-1', 'base');
    });

    it('grants superadmin to a SuperAdmin group member whose record has no role', async () => {
      records({ user: { permissions: { bcparks_7: 'limited' } } });
      await expect(resolveAdminPermissions(payload([SUPERADMIN]))).resolves.toEqual({
        isSuperAdmin: true,
        role: 'superadmin',
        permissions: SUPER_PERMISSIONS,
      });
    });

    it('does not match SuperAdminGroup by prefix or substring', async () => {
      records({ user: null });
      const res = await resolveAdminPermissions(payload([`${SUPERADMIN}-x`]));
      expect(res.isSuperAdmin).toBe(false);
    });

    it('reads a token with no groups claim as no groups', async () => {
      records({ user: scoped() });
      const res = await resolveAdminPermissions({ sub: 'sub-1' });
      expect(res.role).toBe('parkStaff');
    });
  });

  describe('roles', () => {
    it('gives HQ Admin all access without isSuperAdmin', async () => {
      records({ user: { role: 'hqAdmin', permissions: { bcparks_7: 'limited' } } });
      await expect(resolveAdminPermissions(payload([]))).resolves.toEqual({
        isSuperAdmin: false,
        role: 'hqAdmin',
        permissions: SUPER_PERMISSIONS,
      });
    });

    it("lets a SuperAdmin group member's role record apply", async () => {
      records({ user: { role: 'hqAdmin' } });
      const res = await resolveAdminPermissions(payload([SUPERADMIN]));
      expect(res).toMatchObject({ isSuperAdmin: false, role: 'hqAdmin' });
    });

    it.each(['parkStaff', 'parkOperator'])('gives %s every facility of the operator with no narrowTo', async (role) => {
      records({ user: { role, operatorId: 'op-1', permissions: { bcparks_7: 'staff' } } });
      await expect(resolveAdminPermissions(payload([]))).resolves.toEqual({
        isSuperAdmin: false,
        role,
        permissions: {},
        operatorId: 'op-1',
        facilities: ['bcparks_363::trail::9', 'bcparks_7::campground::1', 'bcparks_7::structure::3', 'bcparks_8::lot::1'],
      });
      expect(mockGetOne).toHaveBeenCalledWith('operator::op-1', 'base');
    });

    it('lets a scoped role record apply to a SuperAdmin group member', async () => {
      records({ user: scoped() });
      const res = await resolveAdminPermissions(payload([SUPERADMIN]));
      expect(res).toMatchObject({ isSuperAdmin: false, role: 'parkStaff', permissions: {} });
    });

    it('narrows to a facility key, and an entry outside the grant adds nothing', async () => {
      records({ user: scoped({ narrowTo: ['bcparks_7::structure::3', 'bcparks_99::lot::1'] }) });
      const res = await resolveAdminPermissions(payload([]));
      expect(res.facilities).toEqual(['bcparks_7::structure::3']);
    });

    it('narrows to a park by orcs', async () => {
      records({ user: scoped({ narrowTo: [7] }) });
      const res = await resolveAdminPermissions(payload([]));
      expect(res.facilities).toEqual(['bcparks_7::campground::1', 'bcparks_7::structure::3']);
    });

    it('leaves out a cached facility whose park the operator no longer runs', async () => {
      records({ user: scoped(), operator: { ...OPERATOR, parks: [8], extraFacilities: [] } });
      const res = await resolveAdminPermissions(payload([]));
      expect(res.facilities).toEqual(['bcparks_8::lot::1']);
    });

    it('keeps an extra facility outside the operator parks', async () => {
      records({ user: scoped(), operator: { ...OPERATOR, parks: [] } });
      const res = await resolveAdminPermissions(payload([]));
      expect(res.facilities).toEqual(['bcparks_363::trail::9']);
    });
  });

  describe('fail closed to GET /users/me only', () => {
    it.each([
      ['an unknown role', { role: 'boss' }],
      ['a superadmin role on the record', { role: 'superadmin' }],
      ['a scoped role with no operatorId', { role: 'parkStaff' }],
      ['narrowTo that is empty', scoped({ narrowTo: [] })],
      ['narrowTo that is not a list', scoped({ narrowTo: 'bcparks_7::structure::3' })],
      ['narrowTo with a string park number', scoped({ narrowTo: ['7'] })],
      ['narrowTo with zero', scoped({ narrowTo: [0] })],
      ['narrowTo with a malformed key', scoped({ narrowTo: ['bcparks_7::structure'] })],
      ['narrowTo that leaves nothing', scoped({ narrowTo: [999] })],
    ])('%s', async (_, user) => {
      records({ user });
      await expect(resolveAdminPermissions(payload([]))).resolves.toEqual(USERS_ME_ONLY);
      await expect(resolveAdminPermissions(payload([SUPERADMIN]))).resolves.toEqual(USERS_ME_ONLY);
    });

    it('a missing operator record', async () => {
      records({ user: scoped(), operator: null });
      await expect(resolveAdminPermissions(payload([SUPERADMIN]))).resolves.toEqual(USERS_ME_ONLY);
    });

    it('an operator with no facilities in its grant', async () => {
      records({ user: scoped(), operator: { ...OPERATOR, parks: [], extraFacilities: [] } });
      await expect(resolveAdminPermissions(payload([]))).resolves.toEqual(USERS_ME_ONLY);
    });
  });

  describe('records without a role', () => {
    it('returns the permissions map from the user record', async () => {
      records({ user: { permissions: { bcparks_7: 'staff', bcparks_363: 'limited' } } });
      await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual({
        isSuperAdmin: false,
        permissions: { bcparks_7: 'staff', bcparks_363: 'limited' },
      });
    });

    it('ignores a superadmin key in the tier map', async () => {
      records({ user: { permissions: { superadmin: 'superadmin', bcparks_7: 'limited' } } });
      await expect(resolveAdminPermissions(payload([]))).resolves.toEqual({
        isSuperAdmin: false,
        permissions: { bcparks_7: 'limited' },
      });
    });

    it('returns null permissions when there is no record', async () => {
      records({ user: null });
      await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual(USERS_ME_ONLY);
    });

    it('returns null permissions when the record has no permissions map', async () => {
      records({ user: { pk: 'userid::sub-1', sk: 'base' } });
      await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual(USERS_ME_ONLY);
    });

    it('passes an empty permissions map through as a record', async () => {
      records({ user: { permissions: {} } });
      await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual({ isSuperAdmin: false, permissions: {} });
    });
  });

  it('throws when a record lookup fails, so callers deny', async () => {
    mockGetOne.mockRejectedValue(new Error('throttled'));
    await expect(resolveAdminPermissions(payload([SUPERADMIN]))).rejects.toThrow('throttled');
  });
});
