'use strict';

const mockGetOne = jest.fn();
const mockBatchGetData = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  getOne: (...a) => mockGetOne(...a),
  batchGetData: (...a) => mockBatchGetData(...a),
  USER_ID_PARTITION: 'userid',
}));
const mockVerify = jest.fn();
const mockCreate = jest.fn(() => ({ verify: (...a) => mockVerify(...a) }));
jest.mock('aws-jwt-verify', () => ({ CognitoJwtVerifier: { create: (...a) => mockCreate(...a) } }));

const { handler } = require('../../src/handlers/authorizers/admin');

const ARN = 'arn:aws:execute-api:ca-central-1:123456789012:abc123/api/GET/facilities/bcparks_7';
const BASE = 'arn:aws:execute-api:ca-central-1:123456789012:abc123';
const SUPER = 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup';
const request = (auth = 'Bearer tok', methodArn = ARN) => ({ type: 'REQUEST', methodArn, headers: auth ? { Authorization: auth } : {}, requestContext: {} });
const deny = (arn = ARN) => ({
  principalId: 'user',
  policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: arn }] },
});

describe('admin authorizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_USER_POOL_ID = 'ca-central-1_admin';
    process.env.ADMIN_USER_POOL_CLIENT_ID = 'admin-client';
    process.env.STAGE_NAME = 'api';
  });
  afterAll(() => {
    delete process.env.ADMIN_USER_POOL_ID;
    delete process.env.ADMIN_USER_POOL_CLIENT_ID;
    delete process.env.STAGE_NAME;
  });

  it('denies a request without a bearer token', async () => {
    await expect(handler(request(null))).resolves.toEqual(deny());
    await expect(handler(request('Basic abc'))).resolves.toEqual(deny());
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('denies when the token fails verification', async () => {
    mockVerify.mockRejectedValue(new Error('expired'));
    await expect(handler(request())).resolves.toEqual(deny());
  });

  it('denies a user in the unauthorized group', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-1', 'cognito:groups': ['unauthorized'] });
    const res = await handler(request());
    expect(res.principalId).toBe('sub-1');
    expect(res.policyDocument.Statement[0]).toMatchObject({ Effect: 'Deny', Resource: ARN });
  });

  it('grants a superadmin the whole API', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-1', username: 'boss', 'cognito:groups': [SUPER] });
    const res = await handler(request());
    expect(res.policyDocument.Statement[0]).toEqual({ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: `${BASE}/*` });
    expect(res.context).toEqual({ isAuthenticated: 'true', isAdmin: 'true', permissions: '{"superadmin":"superadmin"}', userId: 'sub-1', username: 'boss' });
  });

  it('allows the union of resource-map paths for each tier the user holds, plus /users/me', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-2', username: 'staffer', 'cognito:groups': ['staff'] });
    mockGetOne.mockResolvedValue({ permissions: { bcparks_7: 'staff', bcparks_8: 'staff', bcparks_9: 'limited' } });
    mockBatchGetData.mockResolvedValue([
      { allowedPaths: ['GET/facilities/*', 'POST/facilities/*'] },
      { allowedPaths: ['GET/facilities/*'] },
    ]);

    const res = await handler(request());

    expect(mockGetOne).toHaveBeenCalledWith('userid::sub-2', 'base');
    expect(mockBatchGetData).toHaveBeenCalledWith([
      { pk: 'resourceMap::staff', sk: 'latest' },
      { pk: 'resourceMap::limited', sk: 'latest' },
    ]);
    expect(res.policyDocument.Statement[0]).toEqual({
      Action: 'execute-api:Invoke',
      Effect: 'Allow',
      Resource: [`${BASE}/api/GET/facilities/*`, `${BASE}/api/POST/facilities/*`, `${BASE}/api/GET/users/me`],
    });
    expect(JSON.parse(res.context.permissions)).toEqual({ bcparks_7: 'staff', bcparks_8: 'staff', bcparks_9: 'limited' });
    expect(res.context.userId).toBe('sub-2');
  });

  it('wildcards the stage when STAGE_NAME is unset', async () => {
    delete process.env.STAGE_NAME;
    mockVerify.mockResolvedValue({ sub: 'sub-2', 'cognito:groups': ['staff'] });
    mockGetOne.mockResolvedValue({ permissions: { bcparks_7: 'limited' } });
    mockBatchGetData.mockResolvedValue([{ allowedPaths: ['GET/facilities/*'] }]);
    const res = await handler(request());
    expect(res.policyDocument.Statement[0].Resource).toEqual([`${BASE}/*/GET/facilities/*`, `${BASE}/*/GET/users/me`]);
    expect(res.context.username).toBe('');
  });

  it('denies when the resource maps cannot be read', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-2', 'cognito:groups': ['staff'] });
    mockGetOne.mockResolvedValue({ permissions: { bcparks_7: 'staff' } });
    mockBatchGetData.mockRejectedValue(new Error('throttled'));
    await expect(handler(request())).resolves.toEqual(deny());
  });

  it('reads the token from a TOKEN authorizer event', async () => {
    mockVerify.mockResolvedValue({ sub: 'sub-1', 'cognito:groups': [SUPER] });
    const res = await handler({ type: 'TOKEN', authorizationToken: 'Bearer tok', methodArn: ARN });
    expect(mockVerify).toHaveBeenCalledWith('tok');
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
  });

  it('uses routeArn from an HTTP API v2 event', async () => {
    const routeArn = 'arn:aws:execute-api:ca-central-1:123456789012:zzz999/api/GET/users/me';
    const res = await handler({ version: '2.0', routeArn, headers: {} });
    expect(res).toEqual(deny(routeArn));
  });

  it('falls back to the config record when the pool env vars are unset', async () => {
    delete process.env.ADMIN_USER_POOL_ID;
    delete process.env.ADMIN_USER_POOL_CLIENT_ID;
    mockGetOne.mockResolvedValueOnce({ ADMIN_USER_POOL_ID: 'ca-central-1_db', ADMIN_USER_POOL_CLIENT_ID: 'db-client' });
    await handler(request(null));
    expect(mockGetOne).toHaveBeenCalledWith('config', 'admin');
    expect(mockCreate).toHaveBeenCalledWith({ userPoolId: 'ca-central-1_db', tokenUse: 'access', clientId: 'db-client' });
  });

  it('throws when neither env nor config record supplies the pool', async () => {
    delete process.env.ADMIN_USER_POOL_ID;
    mockGetOne.mockResolvedValueOnce(null);
    await expect(handler(request())).rejects.toThrow('No config found for admin authorizer.');
  });
});
