'use strict';

const mockListUsers = jest.fn();
const mockAdminGetUser = jest.fn();
jest.mock('/opt/cognito', () => ({
  LIST_USER_FILTER_KEYS: jest.requireActual('../../src/layers/awsUtils/cognito').LIST_USER_FILTER_KEYS,
  listUsers: (...a) => mockListUsers(...a),
  adminGetUser: (...a) => mockAdminGetUser(...a),
}), { virtual: true });
const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({ getOne: (...a) => mockGetOne(...a) }));

const { Exception } = require('/opt/base');
const { handler } = require('../../src/handlers/users/GET/index');
const { handler: meHandler } = require('../../src/handlers/users/me/GET/index');

const get = (pathParameters, queryStringParameters) => ({ httpMethod: 'GET', pathParameters, queryStringParameters });
const body = (res) => JSON.parse(res.body);

describe('GET /users/{userPoolId}', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListUsers.mockResolvedValue([{ Username: 'u1' }]);
    mockAdminGetUser.mockResolvedValue({ Username: 'u1' });
    mockGetOne.mockResolvedValue({ ADMIN_USER_POOL_ID: 'ca-central-1_admin', PUBLIC_USER_POOL_ID: 'ca-central-1_pub' });
  });

  it('requires a user pool', async () => {
    const res = await handler(get({}), {});
    expect(res.statusCode).toBe(400);
    expect(body(res).msg).toBe('User pool ID is required');
  });

  it.each([
    ['admin', 'ca-central-1_admin'],
    ['public', 'ca-central-1_pub'],
  ])('resolves the %s shortform from config and lists 10 users by default', async (alias, poolId) => {
    const res = await handler(get({ userPoolId: alias }), {});
    expect(mockGetOne).toHaveBeenCalledWith('config', alias);
    expect(mockListUsers).toHaveBeenCalledWith(poolId, 10, null, null);
    expect(body(res).data).toEqual([{ Username: 'u1' }]);
  });

  it('keeps the shortform when config has no pool id', async () => {
    mockGetOne.mockResolvedValue(null);
    await handler(get({ userPoolId: 'public' }), {});
    expect(mockListUsers).toHaveBeenCalledWith('public', 10, null, null);
  });

  it('passes a full pool id through untouched', async () => {
    await handler(get({ userPoolId: 'ca-central-1_xyz' }, { limit: '25', paginationToken: 'next' }), {});
    expect(mockGetOne).not.toHaveBeenCalled();
    expect(mockListUsers).toHaveBeenCalledWith('ca-central-1_xyz', 25, 'next', null);
  });

  it.each(['0', '61', 'many'])('resets an out-of-range limit %s to 10', async (limit) => {
    await handler(get({ userPoolId: 'ca-central-1_xyz' }, { limit }), {});
    expect(mockListUsers.mock.calls[0][1]).toBe(10);
  });

  it('accepts the maximum limit of 60', async () => {
    await handler(get({ userPoolId: 'ca-central-1_xyz' }, { limit: '60' }), {});
    expect(mockListUsers.mock.calls[0][1]).toBe(60);
  });

  it('builds a starts-with filter from a recognised query key', async () => {
    await handler(get({ userPoolId: 'ca-central-1_xyz' }, { email: 'ada@', colour: 'blue' }), {});
    expect(mockListUsers).toHaveBeenCalledWith('ca-central-1_xyz', 10, null, 'email ^= "ada@"');
  });

  it('fetches one user when a sub is given in the path or query', async () => {
    let res = await handler(get({ userPoolId: 'ca-central-1_xyz', sub: 'sub-1' }), {});
    expect(mockAdminGetUser).toHaveBeenCalledWith('ca-central-1_xyz', 'sub-1');
    expect(body(res).msg).toBe('User retrieved successfully');
    res = await handler(get({ userPoolId: 'ca-central-1_xyz' }, { sub: 'sub-2' }), {});
    expect(mockAdminGetUser).toHaveBeenLastCalledWith('ca-central-1_xyz', 'sub-2');
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it('returns the Cognito layer error code', async () => {
    mockAdminGetUser.mockRejectedValue(new Exception('Too many requests', { code: 503 }));
    const res = await handler(get({ userPoolId: 'ca-central-1_xyz', sub: 'sub-1' }), {});
    expect(res.statusCode).toBe(503);
    expect(body(res).msg).toBe('Too many requests');
  });
});

describe('GET /users/me', () => {
  afterEach(() => delete process.env.AWS_SAM_LOCAL);

  it('returns the authorizer principal and its parsed permissions', async () => {
    const res = await meHandler({ requestContext: { authorizer: { principalId: 'sub-1', permissions: '{"bcparks_7":"staff"}' } } }, {});
    expect(body(res).data).toEqual({ sub: 'sub-1', permissions: { bcparks_7: 'staff' } });
  });

  it('returns empty permissions for an unprovisioned or malformed context', async () => {
    expect(body(await meHandler({ requestContext: { authorizer: { principalId: 'sub-1' } } }, {})).data).toEqual({ sub: 'sub-1', permissions: {} });
    expect(body(await meHandler({ requestContext: { authorizer: { principalId: 'sub-1', permissions: '{bad' } } }, {})).data).toEqual({ sub: 'sub-1', permissions: {} });
    expect(body(await meHandler({}, {})).data).toEqual({ sub: null, permissions: {} });
  });

  it('reports a local superadmin under SAM local', async () => {
    process.env.AWS_SAM_LOCAL = 'true';
    expect(body(await meHandler({}, {})).data).toEqual({ sub: 'local-dev', permissions: { superadmin: 'superadmin' } });
  });
});
