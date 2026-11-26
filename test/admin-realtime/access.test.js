'use strict';

jest.mock('/opt/cognito', () => ({ adminListGroupsForUser: jest.fn() }));
jest.mock('../../src/handlers/authorizers/admin-permissions', () => ({ resolveAdminPermissions: jest.fn() }));

const { adminListGroupsForUser } = require('/opt/cognito');
const { resolveAdminPermissions } = require('../../src/handlers/authorizers/admin-permissions');
const { currentAccess } = require('../../src/handlers/admin-realtime/access');

process.env.ADMIN_USER_POOL_ID = 'pool-1';
const NONE = { key: null, permissions: null };

describe('currentAccess', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves with the current Cognito groups, not the ones from $connect', async () => {
    adminListGroupsForUser.mockResolvedValue(['unauthorized']);
    resolveAdminPermissions.mockResolvedValue({ unauthorized: true });

    expect(await currentAccess({ userId: 'sub-1', username: 'alice' })).toEqual(NONE);
    expect(adminListGroupsForUser).toHaveBeenCalledWith('pool-1', 'alice');
    expect(resolveAdminPermissions).toHaveBeenCalledWith({ sub: 'sub-1', 'cognito:groups': ['unauthorized'] });
  });

  it('gives no access to a user deleted from the pool', async () => {
    adminListGroupsForUser.mockRejectedValue(Object.assign(new Error('gone'), { name: 'UserNotFoundException' }));
    expect(await currentAccess({ userId: 'sub-1', username: 'alice' })).toEqual(NONE);
    expect(resolveAdminPermissions).not.toHaveBeenCalled();
  });

  it('gives no access to a connection saved without a username, without asking Cognito', async () => {
    expect(await currentAccess({ userId: 'sub-1' })).toEqual(NONE);
    expect(adminListGroupsForUser).not.toHaveBeenCalled();
  });

  it('throws on any other Cognito error, so the connection is left open', async () => {
    adminListGroupsForUser.mockRejectedValue(Object.assign(new Error('slow down'), { name: 'TooManyRequestsException' }));
    await expect(currentAccess({ userId: 'sub-1', username: 'alice' })).rejects.toThrow('slow down');
  });
});
