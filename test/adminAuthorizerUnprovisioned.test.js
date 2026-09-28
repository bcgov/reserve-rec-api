// The no-permissions branch of the admin authorizer. It is the only place an
// unprovisioned user is granted anything, so the test that matters is the one
// asserting it grants nothing but GET /users/me.

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  getOne: (...args) => mockGetOne(...args),
  USER_ID_PARTITION: 'userid',
  batchGetData: jest.fn(),
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

const METHOD_ARN =
  'arn:aws:execute-api:ca-central-1:628373393242:iexxemwse9/api/GET/users/me';

const event = () => ({
  type: 'REQUEST',
  methodArn: METHOD_ARN,
  headers: { Authorization: 'Bearer token' },
  requestContext: {},
});

const { handler } = require('../src/handlers/authorizers/admin');

describe('admin authorizer, user with no permissions record', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STAGE_NAME;
    // Set so the authorizer skips its DynamoDB config lookup; getOne then only
    // serves the user-permissions read this test is about.
    process.env.ADMIN_USER_POOL_ID = 'ca-central-1_test';
    process.env.ADMIN_USER_POOL_CLIENT_ID = 'client-test';
    mockValidateToken.mockResolvedValue({
      sub: 'sub-123',
      username: 'someone',
      'cognito:groups': ['some-group'],
    });
    mockGetOne.mockResolvedValue(null);
  });

  it('allows GET /users/me and nothing else', async () => {
    const res = await handler(event(), {}, () => {});
    const statement = res.policyDocument.Statement[0];

    expect(statement.Effect).toBe('Allow');
    expect(statement.Resource).toEqual([
      'arn:aws:execute-api:ca-central-1:628373393242:iexxemwse9/*/GET/users/me',
    ]);
  });

  it('grants no permissions in the authorizer context', async () => {
    const res = await handler(event(), {}, () => {});
    expect(res.context.permissions).toBe('{}');
    expect(res.context.userId).toBe('sub-123');
    expect(res.context.isAdmin).toBeUndefined();
  });

  it('does not widen access when the record exists but carries no permissions', async () => {
    mockGetOne.mockResolvedValue({ pk: 'userid::sub-123', sk: 'base' });
    const res = await handler(event(), {}, () => {});
    const resource = res.policyDocument.Statement[0].Resource;

    expect(resource).toHaveLength(1);
    expect(resource[0]).toMatch(/\/GET\/users\/me$/);
    expect(resource[0]).not.toMatch(/\/\*$/);
  });
});
