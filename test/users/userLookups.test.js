'use strict';

const mockListUsers = jest.fn();
const mockAdminGetUser = jest.fn();
jest.mock('/opt/cognito', () => ({
  listUsers: (...a) => mockListUsers(...a),
  adminGetUser: (...a) => mockAdminGetUser(...a),
}), { virtual: true });
const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({ getOne: (...a) => mockGetOne(...a) }));

const { getUserInfoByUserName, getUsersByUserPoolId } = require('../../src/handlers/users/methods');

describe('getUserInfoByUserName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOne.mockResolvedValue({ ADMIN_USER_POOL_ID: 'ca-central-1_admin', PUBLIC_USER_POOL_ID: 'ca-central-1_pub' });
    mockAdminGetUser.mockResolvedValue({ Username: 'ada' });
  });

  it.each([
    ['public', 'ca-central-1_pub'],
    ['admin', 'ca-central-1_admin'],
  ])('resolves the %s pool from config', async (alias, poolId) => {
    await expect(getUserInfoByUserName('ada', alias)).resolves.toEqual({ Username: 'ada' });
    expect(mockAdminGetUser).toHaveBeenCalledWith(poolId, 'ada');
  });

  it('defaults to the public pool and keeps a full pool id as given', async () => {
    await getUserInfoByUserName('ada');
    expect(mockAdminGetUser).toHaveBeenLastCalledWith('ca-central-1_pub', 'ada');
    await getUserInfoByUserName('ada', 'ca-central-1_other');
    expect(mockAdminGetUser).toHaveBeenLastCalledWith('ca-central-1_other', 'ada');
    expect(mockGetOne).toHaveBeenCalledTimes(1);
  });

  it('keeps the alias when config has no pool id', async () => {
    mockGetOne.mockResolvedValue({});
    await getUserInfoByUserName('ada', 'admin');
    expect(mockAdminGetUser).toHaveBeenCalledWith('admin', 'ada');
  });

  it('hides Cognito failures behind a generic error', async () => {
    mockAdminGetUser.mockRejectedValue(new Error('AccessDenied'));
    await expect(getUserInfoByUserName('ada')).rejects.toThrow('Error fetching user info');
  });
});

describe('getUsersByUserPoolId', () => {
  it('lists up to 60 users of the pool', async () => {
    mockListUsers.mockResolvedValue([{ Username: 'a' }]);
    await expect(getUsersByUserPoolId('ca-central-1_x')).resolves.toEqual([{ Username: 'a' }]);
    expect(mockListUsers).toHaveBeenCalledWith('ca-central-1_x', 60);
  });

  it('hides Cognito failures behind a generic error', async () => {
    mockListUsers.mockRejectedValue(new Error('boom'));
    await expect(getUsersByUserPoolId('ca-central-1_x')).rejects.toThrow('Error fetching users');
  });
});
