// Availability reads through the public authorizer: a signed-in caller whose
// account is unverified, disabled or gone is answered exactly as an invalid
// token is, as a guest.

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('/opt/base', () => ({ logger: mockLogger }));

jest.mock('/opt/dynamodb', () => ({ getOne: jest.fn() }));

const mockAdminGetUser = jest.fn();
jest.mock('/opt/cognito', () => ({ adminGetUser: (...args) => mockAdminGetUser(...args) }), { virtual: true });

const mockVerify = jest.fn();
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: (...args) => mockVerify(...args) }) },
}));

const SUB = '11111111-2222-4333-8444-555555555555';
const ARN_PREFIX = 'arn:aws:execute-api:ca-central-1:123456789012:abc123/api';
const INVENTORY_ARN = `${ARN_PREFIX}/GET/inventoryPools/bcparks_1/dayuse/1/1`;
const PRODUCT_DATES_ARN = `${ARN_PREFIX}/GET/product-dates/bcparks_1/dayuse/1/1`;

const event = (methodArn = INVENTORY_ARN, authorization = 'Bearer token') => ({
  type: 'REQUEST',
  methodArn,
  headers: authorization ? { Authorization: authorization } : {},
  requestContext: {},
});

const cognitoUser = ({ enabled = true, emailVerified = 'true', identities, sub = SUB } = {}) => ({
  Username: 'someone',
  Enabled: enabled,
  UserAttributes: [
    { Name: 'sub', Value: sub },
    { Name: 'email_verified', Value: emailVerified },
    ...(identities ? [{ Name: 'identities', Value: identities }] : []),
  ],
});

const notFound = () => {
  const error = new Error('Failed to get user');
  Object.defineProperty(error, 'cause', { value: { name: 'UserNotFoundException' } });
  return error;
};

// A fresh module per test, so the account status cache starts empty.
function loadHandler() {
  let handler;
  jest.isolateModules(() => {
    ({ handler } = require('../src/handlers/authorizers/public'));
  });
  return handler;
}

const GUEST = { isAuthenticated: 'false', userId: 'guest', email: '', username: '' };
const SIGNED_IN = { isAuthenticated: 'true', userId: SUB };

const deniedLines = () => mockLogger.info.mock.calls.filter(([msg]) => msg === 'event=availability_denied');

describe('public authorizer, account status on availability reads', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_USER_POOL_ID = 'ca-central-1_test';
    process.env.PUBLIC_USER_POOL_CLIENT_ID = 'client-test';
    mockVerify.mockResolvedValue({ sub: SUB, username: 'someone', email: 'a@example.com' });
    handler = loadHandler();
  });

  it('keeps a verified, enabled account signed in, looking it up by token username', async () => {
    mockAdminGetUser.mockResolvedValue(cognitoUser());
    const res = await handler(event());
    expect(res.context).toMatchObject(SIGNED_IN);
    expect(mockAdminGetUser).toHaveBeenCalledWith('ca-central-1_test', 'someone');
    expect(deniedLines()).toHaveLength(0);
  });

  it('applies to product dates too', async () => {
    mockAdminGetUser.mockResolvedValue(cognitoUser({ emailVerified: 'false' }));
    const res = await handler(event(PRODUCT_DATES_ARN));
    expect(res.context).toMatchObject(GUEST);
  });

  it.each([
    ['an unverified email', () => mockAdminGetUser.mockResolvedValue(cognitoUser({ emailVerified: 'false' }))],
    ['a disabled account', () => mockAdminGetUser.mockResolvedValue(cognitoUser({ enabled: false }))],
    ['a deleted account', () => mockAdminGetUser.mockRejectedValue(notFound())],
    ['a lookup that names another sub', () => mockAdminGetUser.mockResolvedValue(cognitoUser({ sub: '99999999-2222-4333-8444-555555555555' }))],
    ['a Cognito error', () => mockAdminGetUser.mockRejectedValue(new Error('Failed to get user'))],
  ])('answers %s as a guest, the same as an invalid token', async (_, arrange) => {
    arrange();
    const denied = await handler(event());

    mockVerify.mockRejectedValueOnce(new Error('expired'));
    const invalidToken = await handler(event());

    expect(denied).toEqual(invalidToken);
    expect(denied.context).toMatchObject(GUEST);
    expect(denied.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(deniedLines()).toEqual([['event=availability_denied', { sub: SUB }]]);
  });

  it('treats a BCSC account as verified whatever its email_verified says', async () => {
    mockVerify.mockResolvedValue({ sub: SUB, username: 'bcsc_abc' });
    mockAdminGetUser.mockResolvedValue(cognitoUser({
      emailVerified: 'false',
      identities: JSON.stringify([{ providerName: 'BCSC', userId: 'abc' }]),
    }));
    const res = await handler(event());
    expect(res.context).toMatchObject(SIGNED_IN);
  });

  it('still refuses a disabled BCSC account', async () => {
    mockAdminGetUser.mockResolvedValue(cognitoUser({
      enabled: false,
      identities: JSON.stringify([{ providerName: 'BCSC', userId: 'abc' }]),
    }));
    const res = await handler(event());
    expect(res.context).toMatchObject(GUEST);
  });

  it('does not exempt a bcsc_ username without a BCSC identity', async () => {
    mockVerify.mockResolvedValue({ sub: SUB, username: 'bcsc_abc' });
    mockAdminGetUser.mockResolvedValue(cognitoUser({ emailVerified: 'false' }));
    const res = await handler(event());
    expect(res.context).toMatchObject(GUEST);
  });

  it('caches the answer by sub for 60 seconds', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockAdminGetUser.mockResolvedValue(cognitoUser());
    await handler(event());
    now.mockReturnValue(1_059_000);
    const cached = await handler(event());
    expect(cached.context).toMatchObject(SIGNED_IN);
    expect(mockAdminGetUser).toHaveBeenCalledTimes(1);

    mockAdminGetUser.mockResolvedValue(cognitoUser({ enabled: false }));
    now.mockReturnValue(1_060_001);
    const expired = await handler(event());
    expect(expired.context).toMatchObject(GUEST);
    expect(mockAdminGetUser).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('does not cache a Cognito error', async () => {
    mockAdminGetUser.mockRejectedValueOnce(new Error('Failed to get user')).mockResolvedValue(cognitoUser());
    expect((await handler(event())).context).toMatchObject(GUEST);
    expect((await handler(event())).context).toMatchObject(SIGNED_IN);
    expect(mockAdminGetUser).toHaveBeenCalledTimes(2);
  });

  it('does not look the account up on other routes', async () => {
    const res = await handler(event(`${ARN_PREFIX}/GET/bookings`));
    expect(res.context).toMatchObject(SIGNED_IN);
    expect(mockAdminGetUser).not.toHaveBeenCalled();
  });

  it('does not look up guests', async () => {
    const res = await handler(event(INVENTORY_ARN, null));
    expect(res.context).toMatchObject(GUEST);
    expect(mockAdminGetUser).not.toHaveBeenCalled();
  });
});
