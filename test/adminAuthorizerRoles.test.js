// Admin authorizer policy and context for each role (#682).

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGetOne = jest.fn();
const mockBatchGetData = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  getOne: (...args) => mockGetOne(...args),
  batchGetData: (...args) => mockBatchGetData(...args),
  USER_ID_PARTITION: 'userid',
}));

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: jest.fn() }) },
}));

const mockValidateToken = jest.fn();
jest.mock('../src/handlers/authorizers/methods', () => ({
  authorizeAll: jest.fn(),
  generatePolicy: jest.fn((principalId, effect, resource) => ({
    principalId,
    policyDocument: { Statement: [{ Effect: effect, Resource: resource }] },
  })),
  getDenyPolicy: jest.fn(),
  parseToken: jest.fn(async () => ({ valid: true, token: 'token' })),
  validateToken: (...args) => mockValidateToken(...args),
  queryAndGenerateResources: jest.fn(),
}));

const { handler } = require('../src/handlers/authorizers/admin');

const BASE = 'arn:aws:execute-api:ca-central-1:123456789012:abc123';
const event = () => ({
  type: 'REQUEST',
  methodArn: `${BASE}/api/GET/facilities/bcparks_7`,
  headers: { Authorization: 'Bearer token' },
  requestContext: {},
});
const SUPERADMIN = 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup';
const OPERATOR = {
  orcs: [7],
  extraFacilities: [],
  facilities: { 'bcparks_7::structure::3': { orcs: 7, displayName: 'Hut' } },
};

function records(user, operator = OPERATOR) {
  mockGetOne.mockImplementation(async (pk) => {
    if (pk === 'userid::sub-1') return user;
    if (pk === 'operator::op-1') return operator;
    return null;
  });
}

const signIn = (groups = []) => mockValidateToken.mockResolvedValue({ sub: 'sub-1', username: 'someone', 'cognito:groups': groups });
const statement = (res) => res.policyDocument.Statement[0];

describe('admin authorizer roles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_USER_POOL_ID = 'ca-central-1_test';
    process.env.ADMIN_USER_POOL_CLIENT_ID = 'client-test';
    process.env.STAGE_NAME = 'api';
  });
  afterAll(() => {
    delete process.env.STAGE_NAME;
  });

  it('gives a SuperAdmin group member with no record isAdmin and role superadmin', async () => {
    signIn([SUPERADMIN]);
    records(null);
    const res = await handler(event());
    expect(statement(res)).toMatchObject({ Effect: 'Allow', Resource: `${BASE}/*` });
    expect(res.context).toEqual({
      isAuthenticated: 'true',
      isAdmin: 'true',
      role: 'superadmin',
      permissions: '{"superadmin":"superadmin"}',
      userId: 'sub-1',
      username: 'someone',
    });
  });

  it('gives HQ Admin the whole API without isAdmin', async () => {
    signIn([SUPERADMIN]);
    records({ role: 'hqAdmin' });
    const res = await handler(event());
    expect(statement(res)).toMatchObject({ Effect: 'Allow', Resource: `${BASE}/*` });
    expect(res.context).toEqual({
      isAuthenticated: 'true',
      role: 'hqAdmin',
      permissions: '{"superadmin":"superadmin"}',
      userId: 'sub-1',
      username: 'someone',
    });
    expect(mockBatchGetData).not.toHaveBeenCalled();
  });

  it.each(['parkStaff', 'parkOperator'])('gives %s its resource map, no collections and its facility keys', async (role) => {
    signIn();
    records({ role, operatorId: 'op-1', permissions: { bcparks_7: 'staff' } });
    mockBatchGetData.mockResolvedValue([{ allowedPaths: ['GET/facilities/*'] }]);

    const res = await handler(event());

    expect(mockBatchGetData).toHaveBeenCalledWith([{ pk: `resourceMap::${role}`, sk: 'latest' }]);
    expect(statement(res)).toEqual({
      Action: 'execute-api:Invoke',
      Effect: 'Allow',
      Resource: [`${BASE}/api/GET/facilities/*`, `${BASE}/api/GET/users/me`],
    });
    expect(res.context).toEqual({
      isAuthenticated: 'true',
      role,
      permissions: '{}',
      operatorId: 'op-1',
      facilities: '["bcparks_7::structure::3"]',
      userId: 'sub-1',
      username: 'someone',
    });
  });

  it('gives a scoped role only GET /users/me while its resource map does not exist', async () => {
    signIn();
    records({ role: 'parkStaff', operatorId: 'op-1' });
    mockBatchGetData.mockResolvedValue([]);
    const res = await handler(event());
    expect(statement(res).Resource).toEqual([`${BASE}/api/GET/users/me`]);
  });

  it.each([
    ['an unknown role', { role: 'superadmin' }],
    ['a missing operator', { role: 'parkStaff', operatorId: 'op-2' }],
    ['a bad narrowTo', { role: 'parkStaff', operatorId: 'op-1', narrowTo: [] }],
  ])('gives a SuperAdmin group member with %s GET /users/me only', async (_, user) => {
    signIn([SUPERADMIN]);
    records(user);
    const res = await handler(event());
    expect(statement(res).Resource).toEqual([`${BASE}/api/GET/users/me`]);
    expect(res.context.permissions).toBe('{}');
    expect(res.context.isAdmin).toBeUndefined();
    expect(res.context.role).toBeUndefined();
  });

  it('denies the unauthorized group even with a role record', async () => {
    signIn(['unauthorized']);
    records({ role: 'hqAdmin' });
    const res = await handler(event());
    expect(statement(res).Effect).toBe('Deny');
  });

  it('keeps a record without role on its tier map, minus a superadmin key', async () => {
    signIn();
    records({ permissions: { superadmin: 'superadmin', bcparks_7: 'limited' } });
    mockBatchGetData.mockResolvedValue([{ allowedPaths: ['GET/facilities/*'] }]);
    const res = await handler(event());
    expect(mockBatchGetData).toHaveBeenCalledWith([{ pk: 'resourceMap::limited', sk: 'latest' }]);
    expect(res.context.permissions).toBe('{"bcparks_7":"limited"}');
    expect(res.context.role).toBeUndefined();
  });

  it('gives a tier map holding only a superadmin key GET /users/me only, with no resource map read', async () => {
    signIn();
    records({ permissions: { superadmin: 'superadmin' } });
    const res = await handler(event());
    expect(mockBatchGetData).not.toHaveBeenCalled();
    expect(statement(res)).toMatchObject({ Effect: 'Allow', Resource: [`${BASE}/api/GET/users/me`] });
    expect(res.context.permissions).toBe('{}');
  });
});
