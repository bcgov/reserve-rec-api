'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  getOne: (...args) => mockGetOne(...args),
  USER_ID_PARTITION: 'userid',
}));

// The verifier is built for the admin pool, so anything it rejects (a public-pool
// token, an expired token, garbage) surfaces as a verify() rejection.
const mockVerify = jest.fn();
const mockCreate = jest.fn(() => ({ verify: mockVerify }));
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: (...args) => mockCreate(...args) },
}));

process.env.ADMIN_USER_POOL_ID = 'ca-central-1_admin';
process.env.ADMIN_USER_POOL_CLIENT_ID = 'admin-client';

const { logger } = require('/opt/base');
const { handler } = require('../../src/handlers/admin-realtime/authorizer');

const METHOD_ARN = 'arn:aws:execute-api:ca-central-1:123456789012:wsapi123/ws/$connect';
const event = (token = 'jwt') => ({ type: 'REQUEST', methodArn: METHOD_ARN, queryStringParameters: { token } });
const effect = (res) => res.policyDocument.Statement[0].Effect;

const payload = (groups, sub = 'sub-1') => ({ sub, username: 'alice', exp: 1760003600, 'cognito:groups': groups });

describe('admin realtime authorizer', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockGetOne.mockReset();
    delete process.env.REALTIME_STAFF_ADDED_ENABLED;
  });

  it('verifies against the admin pool with access tokens', async () => {
    mockVerify.mockResolvedValue(payload(['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup']));
    await handler(event());
    expect(mockCreate).toHaveBeenCalledWith({
      userPoolId: 'ca-central-1_admin',
      clientId: 'admin-client',
      tokenUse: 'access',
    });
    expect(mockVerify).toHaveBeenCalledWith('jwt');
  });

  it('allows a superadmin with string context and the $connect resource', async () => {
    mockVerify.mockResolvedValue(payload(['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup']));
    const res = await handler(event());

    expect(effect(res)).toBe('Allow');
    expect(res.policyDocument.Statement[0].Resource).toBe(METHOD_ARN);
    expect(res.principalId).toBe('sub-1');
    expect(res.context).toEqual({
      userId: 'sub-1',
      permissions: JSON.stringify({ superadmin: 'superadmin' }),
      isSuperAdmin: 'true',
      exp: '1760003600',
    });
    expect(mockGetOne).not.toHaveBeenCalled();
  });

  it.each([
    ['off', undefined],
    ['explicitly off', 'false'],
  ])('denies staff while staff added events are %s', async (_, flag) => {
    if (flag !== undefined) process.env.REALTIME_STAFF_ADDED_ENABLED = flag;
    mockVerify.mockResolvedValue(payload(['bcparks-staff'], 'sub-2'));
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-2', sk: 'base', permissions: { bcparks_7: 'staff' } });
    expect(effect(await handler(event()))).toBe('Deny');
  });

  it('allows staff with the permissions from their user record while staff added events are on', async () => {
    process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';
    mockVerify.mockResolvedValue(payload(['bcparks-staff'], 'sub-2'));
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-2', sk: 'base', permissions: { bcparks_7: 'staff' } });
    const res = await handler(event());

    expect(mockGetOne).toHaveBeenCalledWith('userid::sub-2', 'base');
    expect(effect(res)).toBe('Allow');
    expect(res.context.permissions).toBe('{"bcparks_7":"staff"}');
    expect(res.context.isSuperAdmin).toBe('false');
    for (const value of Object.values(res.context)) expect(typeof value).toBe('string');
  });

  it('denies a missing token without calling the verifier', async () => {
    const res = await handler({ type: 'REQUEST', methodArn: METHOD_ARN, queryStringParameters: null });
    expect(effect(res)).toBe('Deny');
    expect(res.context).toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('denies a public-pool token', async () => {
    mockVerify.mockRejectedValue(new Error('Issuer not allowed'));
    expect(effect(await handler(event('public-pool-jwt')))).toBe('Deny');
  });

  it('denies an expired token', async () => {
    mockVerify.mockRejectedValue(Object.assign(new Error('Token expired'), { name: 'JwtExpiredError' }));
    expect(effect(await handler(event('expired-jwt')))).toBe('Deny');
    expect(logger.info).toHaveBeenCalledWith('Admin realtime auth: token rejected', { reason: 'JwtExpiredError', error: 'Token expired' });
  });

  it('denies the unauthorized group', async () => {
    mockVerify.mockResolvedValue(payload(['unauthorized']));
    const res = await handler(event());
    expect(effect(res)).toBe('Deny');
    expect(mockGetOne).not.toHaveBeenCalled();
  });

  it('denies a user with no permissions record', async () => {
    mockVerify.mockResolvedValue(payload(['bcparks-staff']));
    mockGetOne.mockResolvedValue(null);
    expect(effect(await handler(event()))).toBe('Deny');
  });

  it.each([
    ['only limited tiers', { bcparks_7: 'limited', bcparks_8: 'limited' }],
    ['an empty permissions map', {}],
  ])('denies a user with %s even while staff added events are on', async (_, permissions) => {
    process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';
    mockVerify.mockResolvedValue(payload(['bcparks-staff']));
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-1', sk: 'base', permissions });
    expect(effect(await handler(event()))).toBe('Deny');
  });

  it('allows a user with staff on any one park alongside limited ones while staff added events are on', async () => {
    process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';
    mockVerify.mockResolvedValue(payload(['bcparks-staff']));
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-1', sk: 'base', permissions: { bcparks_7: 'limited', bcparks_8: 'staff' } });
    expect(effect(await handler(event()))).toBe('Allow');
  });

  it('denies a user record without a permissions map', async () => {
    mockVerify.mockResolvedValue(payload(['bcparks-staff']));
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-1', sk: 'base' });
    expect(effect(await handler(event()))).toBe('Deny');
  });

  it('denies a token with no groups claim', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-1', username: 'alice' });
    expect(effect(await handler(event()))).toBe('Deny');
  });

  it('denies when the permissions lookup fails', async () => {
    mockVerify.mockResolvedValue(payload(['bcparks-staff']));
    mockGetOne.mockRejectedValue(new Error('throttled'));
    expect(effect(await handler(event()))).toBe('Deny');
  });
});
