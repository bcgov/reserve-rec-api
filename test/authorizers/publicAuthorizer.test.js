'use strict';

const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({ getOne: (...a) => mockGetOne(...a) }));
jest.mock('/opt/cognito', () => ({ adminGetUser: jest.fn() }), { virtual: true });
jest.mock('../../src/handlers/authorizers/tokenNetworks', () => ({ checkNetworks: jest.fn() }));
const mockVerify = jest.fn();
const mockCreate = jest.fn(() => ({ verify: (...a) => mockVerify(...a) }));
jest.mock('aws-jwt-verify', () => ({ CognitoJwtVerifier: { create: (...a) => mockCreate(...a) } }));

const { handler } = require('../../src/handlers/authorizers/public');

const ARN = 'arn:aws:execute-api:ca-central-1:123456789012:abc123/api/GET/facilities/bcparks_7';
const ALL = 'arn:aws:execute-api:ca-central-1:123456789012:abc123/*';
const admission = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const request = (headers = {}) => ({ type: 'REQUEST', methodArn: ARN, headers, requestContext: {} });
const GUEST = { isAuthenticated: 'false', userId: 'guest', userType: 'guest', email: '', username: '', isAdmin: 'false', role: 'public' };
const NO_ADMISSION = { admissionPresent: 'false', admissionFacilityKey: '', admissionDateKey: '' };

describe('public authorizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_USER_POOL_ID = 'ca-central-1_pub';
    process.env.PUBLIC_USER_POOL_CLIENT_ID = 'pub-client';
  });
  afterAll(() => {
    delete process.env.PUBLIC_USER_POOL_ID;
    delete process.env.PUBLIC_USER_POOL_CLIENT_ID;
  });

  it('allows a guest across the whole API', async () => {
    const res = await handler(request());
    expect(res).toEqual({
      principalId: 'public',
      policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: ALL }] },
      context: { ...GUEST, ...NO_ADMISSION },
    });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('signs in a valid bearer token with its sub, email and username', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-1', email: 'a@example.com', username: 'ada' });
    const res = await handler(request({ authorization: 'Bearer tok' }));
    expect(mockVerify).toHaveBeenCalledWith('tok');
    expect(res.context).toMatchObject({ isAuthenticated: 'true', userId: 'sub-1', userType: 'authenticated', email: 'a@example.com', username: 'ada' });
  });

  it.each([
    ['a non-Bearer scheme', 'Token tok'],
    ['a bare token', 'tok'],
    ['the literal None', 'None'],
  ])('treats %s as a guest without verifying', async (_, authorization) => {
    const res = await handler(request({ Authorization: authorization }));
    expect(res.context).toMatchObject(GUEST);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('treats a token that fails verification as a guest', async () => {
    mockVerify.mockRejectedValue(Object.assign(new Error('expired'), { name: 'JwtExpiredError' }));
    const res = await handler(request({ Authorization: 'Bearer tok' }));
    expect(res.context).toMatchObject(GUEST);
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
  });

  it('passes the unverified admission cookie keys into the context', async () => {
    const cookie = `theme=dark; bcparks-admission=${admission({ fk: 'bcparks_7::dayuse::1', dk: '2026-07-01' })}; other`;
    const res = await handler(request({ Cookie: cookie }));
    expect(res.context).toMatchObject({ admissionPresent: 'true', admissionFacilityKey: 'bcparks_7::dayuse::1', admissionDateKey: '2026-07-01' });
  });

  it.each([
    ['without a dot', 'abc'],
    ['with an undecodable payload', '!!!.sig'],
  ])('marks an admission cookie %s present but keyless', async (_, value) => {
    const res = await handler(request({ cookie: `bcparks-admission=${value}` }));
    expect(res.context).toMatchObject({ admissionPresent: 'true', admissionFacilityKey: '', admissionDateKey: '' });
  });

  it('reads the token from a TOKEN authorizer event', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-1' });
    const res = await handler({ type: 'TOKEN', authorizationToken: 'Bearer tok', methodArn: ARN });
    expect(res.context).toMatchObject({ isAuthenticated: 'true', userId: 'sub-1', ...NO_ADMISSION });
  });

  it('uses routeArn from an HTTP API v2 event', async () => {
    const res = await handler({ version: '2.0', routeArn: 'arn:aws:execute-api:ca-central-1:123456789012:zzz999/api/GET/x', headers: {} });
    expect(res.policyDocument.Statement[0].Resource).toBe('arn:aws:execute-api:ca-central-1:123456789012:zzz999/*');
  });

  it('accepts an event with neither type nor headers', async () => {
    const res = await handler({ methodArn: ARN });
    expect(res.context).toMatchObject(GUEST);
  });

  it('answers as a guest when no pool is configured anywhere', async () => {
    delete process.env.PUBLIC_USER_POOL_CLIENT_ID;
    mockGetOne.mockResolvedValue({ PUBLIC_USER_POOL_ID: 'ca-central-1_db' });
    const res = await handler(request({ Authorization: 'Bearer tok' }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.context).toMatchObject(GUEST);
  });

  it('throws when the pool env vars are unset and there is no config record', async () => {
    delete process.env.PUBLIC_USER_POOL_ID;
    mockGetOne.mockResolvedValue(null);
    await expect(handler(request())).rejects.toThrow('No config found for public authorizer.');
  });
});
