'use strict';

const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  getOne: (...args) => mockGetOne(...args),
  USER_ID_PARTITION: 'userid',
}));

const { resolveAdminPermissions } = require('../src/handlers/authorizers/admin-permissions');

const payload = (groups) => ({ sub: 'sub-1', 'cognito:groups': groups });
const SUPERADMIN = 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup';

describe('resolveAdminPermissions', () => {
  beforeEach(() => mockGetOne.mockReset());

  it.each([
    ['the unauthorized group', ['unauthorized']],
    ['an empty group name', ['']],
    ['unauthorized alongside SuperAdmin', [SUPERADMIN, 'unauthorized']],
  ])('flags %s as unauthorized without a lookup', async (_, groups) => {
    await expect(resolveAdminPermissions(payload(groups))).resolves.toEqual({ unauthorized: true });
    expect(mockGetOne).not.toHaveBeenCalled();
  });

  it('grants superadmin on the SuperAdminGroup suffix without a lookup', async () => {
    await expect(resolveAdminPermissions(payload(['staff', SUPERADMIN]))).resolves.toEqual({
      isSuperAdmin: true,
      permissions: { superadmin: 'superadmin' },
    });
    expect(mockGetOne).not.toHaveBeenCalled();
  });

  it('does not match SuperAdminGroup by prefix or substring', async () => {
    mockGetOne.mockResolvedValue(null);
    const res = await resolveAdminPermissions(payload([`${SUPERADMIN}-x`]));
    expect(res.isSuperAdmin).toBe(false);
  });

  it('returns the permissions map from the user record', async () => {
    mockGetOne.mockResolvedValue({ permissions: { bcparks_7: 'staff', bcparks_363: 'limited' } });
    await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual({
      isSuperAdmin: false,
      permissions: { bcparks_7: 'staff', bcparks_363: 'limited' },
    });
    expect(mockGetOne).toHaveBeenCalledWith('userid::sub-1', 'base');
  });

  it('returns null permissions when there is no record', async () => {
    mockGetOne.mockResolvedValue(null);
    await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual({ isSuperAdmin: false, permissions: null });
  });

  it('returns null permissions when the record has no permissions map', async () => {
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-1', sk: 'base' });
    await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual({ isSuperAdmin: false, permissions: null });
  });

  it('passes an empty permissions map through as a record', async () => {
    mockGetOne.mockResolvedValue({ permissions: {} });
    await expect(resolveAdminPermissions(payload(['staff']))).resolves.toEqual({ isSuperAdmin: false, permissions: {} });
  });

  it('throws when the token has no groups claim', async () => {
    await expect(resolveAdminPermissions({ sub: 'sub-1' })).rejects.toThrow(TypeError);
  });
});
