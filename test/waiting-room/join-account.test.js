'use strict';

const mockAdminGetUser = jest.fn();
jest.mock('/opt/cognito', () => ({ adminGetUser: (...args) => mockAdminGetUser(...args) }), { virtual: true });
const mockCreate = jest.fn();
const mockVerify = jest.fn();
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: (...args) => { mockCreate(...args); return { verify: (...a) => mockVerify(...a) }; } },
}));
jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  buildQueueId: (c, at, ai, sd) => `QUEUE#${c}#${at}#${ai}#${sd}`,
  getQueueMeta: jest.fn(),
  getQueueEntry: jest.fn(),
  putQueueEntry: jest.fn(),
  incrementQueueTotalEntries: jest.fn(),
  queryEntriesByUserId: jest.fn(),
  queryEntriesByClientIp: jest.fn(),
  abandonQueueEntry: jest.fn(),
  incrementAbandonedCount: jest.fn(),
  getActiveMode2QueueId: jest.fn(),
}));

const db = require('../../src/handlers/waiting-room/utils/dynamodb');

const NOW = Date.parse('2026-07-01T12:00:00Z');
const queueId = 'QUEUE#bcparks_7#dayuse#1#2026-07-02';
const ID_TOKEN = 'header.payload.signature';
const join = (claims, headers = { 'x-id-token': ID_TOKEN }) => ({
  httpMethod: 'POST',
  body: JSON.stringify({ collectionId: 'bcparks_7', activityType: 'dayuse', activityId: '1', startDate: '2026-07-02' }),
  headers: { 'CloudFront-Viewer-Address': '1.2.3.4:443', ...headers },
  requestContext: { authorizer: { isAuthenticated: 'true', claims: { sub: 'sub-1', ...claims } } },
});
const body = (res) => JSON.parse(res.body);
const idToken = (claims = {}) => ({ sub: 'sub-1', token_use: 'id', email_verified: true, ...claims });

// The handler's module registry, so thrown errors share its aws-jwt-verify error classes.
let jwtErrors;
function loadHandler(env) {
  Object.assign(process.env, { PUBLIC_USER_POOL_ID: 'ca-central-1_pub', PUBLIC_USER_POOL_CLIENT_ID: 'public-client', ...env });
  let handler;
  jest.isolateModules(() => {
    ({ handler } = require('../../src/handlers/waiting-room/join/handler'));
    jwtErrors = require('aws-jwt-verify/error');
  });
  return handler;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  db.getQueueMeta.mockResolvedValue({ pk: queueId, queueStatus: 'pre-open', openingTime: '2026-07-02T14:00:00Z' });
  db.queryEntriesByUserId.mockResolvedValue([]);
  db.queryEntriesByClientIp.mockResolvedValue([]);
  db.getQueueEntry.mockResolvedValue(null);
  mockVerify.mockResolvedValue(idToken());
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env.PUBLIC_USER_POOL_ID;
  delete process.env.PUBLIC_USER_POOL_CLIENT_ID;
});

describe('WaitingRoom JOIN', () => {
  it('returns the existing entry instead of overwriting it when a racing join already wrote one', async () => {
    const handler = loadHandler({});
    db.getQueueEntry.mockResolvedValue({ status: 'admitted', joinedAt: 1782900000 });
    const res = await handler(join({}), {});
    expect(body(res)).toMatchObject({ msg: 'Already joined this queue', data: { status: 'admitted', joinedAt: 1782900000 } });
    expect(db.putQueueEntry).not.toHaveBeenCalled();
  });

  it('returns 500 on an unexpected failure', async () => {
    const handler = loadHandler({});
    db.getQueueMeta.mockRejectedValue(new Error('boom'));
    const res = await handler(join({}), {});
    expect(res.statusCode).toBe(500);
    expect(body(res).msg).toBe('Internal server error');
  });
});

describe('WaitingRoom JOIN ID token gate', () => {
  let handler;
  beforeEach(() => { handler = loadHandler({}); });

  const refusedWith = (res, statusCode, errorCode) => {
    expect(res.statusCode).toBe(statusCode);
    expect(body(res).errorCode).toBe(errorCode);
    expect(db.putQueueEntry).not.toHaveBeenCalled();
  };

  it('admits a verified account on its ID token alone, without calling Cognito', async () => {
    const res = await handler(join({}, { 'X-Id-Token': ID_TOKEN }), {});
    expect(res.statusCode).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith(ID_TOKEN);
    expect(mockCreate).toHaveBeenCalledWith({ userPoolId: 'ca-central-1_pub', tokenUse: 'id', clientId: 'public-client' });
    expect(mockAdminGetUser).not.toHaveBeenCalled();
    expect(db.putQueueEntry).toHaveBeenCalledWith(expect.objectContaining({ userId: 'sub-1', status: 'waiting' }));
  });

  it('builds the verifier once per container, so the JWKS stays cached', async () => {
    await handler(join({}), {});
    await handler(join({}), {});
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['false', false],
    ["'false'", 'false'],
    ['absent', undefined],
  ])('refuses a BC Parks account whose email_verified claim is %s', async (_, emailVerified) => {
    mockVerify.mockResolvedValue(idToken({ email_verified: emailVerified }));
    const res = await handler(join({}), {});
    refusedWith(res, 403, 'EMAIL_UNVERIFIED');
    expect(body(res).msg).toBe('Verify your email address to join the waiting room.');
  });

  it("accepts email_verified as the string 'true'", async () => {
    mockVerify.mockResolvedValue(idToken({ email_verified: 'true' }));
    expect((await handler(join({}), {})).statusCode).toBe(200);
  });

  it.each([
    ['an array', [{ providerName: 'BCSC', userId: 'x' }]],
    ['a JSON string', JSON.stringify([{ providerName: 'BCSC', userId: 'x' }])],
  ])('admits a BC Services Card account with an unverified email, identities as %s', async (_, identities) => {
    mockVerify.mockResolvedValue(idToken({ email_verified: false, identities }));
    const res = await handler(join({}), {});
    expect(res.statusCode).toBe(200);
    expect(db.putQueueEntry).toHaveBeenCalled();
  });

  it('does not give up a place held in another queue when refused', async () => {
    db.queryEntriesByUserId.mockResolvedValue([{ pk: 'QUEUE#other#dayuse#1#2026-07-02', status: 'waiting' }]);
    mockVerify.mockResolvedValue(idToken({ email_verified: false }));
    await handler(join({}), {});
    expect(db.abandonQueueEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['the header is missing', () => {}, {}],
    ['the signature is bad', () => mockVerify.mockRejectedValue(new jwtErrors.JwtInvalidSignatureError('Invalid signature')), undefined],
    ['the token has expired', () => mockVerify.mockRejectedValue(new jwtErrors.JwtExpiredError('Token expired', 1, 2)), undefined],
    ['it is not an ID token', () => mockVerify.mockRejectedValue(new jwtErrors.CognitoJwtInvalidTokenUseError('Token use not allowed', 'access', ['id'])), undefined],
    ['it belongs to another user', () => mockVerify.mockResolvedValue(idToken({ sub: 'someone-else' })), undefined],
  ])('refuses with 401 when %s', async (_, arrange, headers) => {
    arrange();
    const res = await handler(join({}, headers), {});
    refusedWith(res, 401, 'ID_TOKEN_INVALID');
  });

  it.each([
    ["Cognito's JWKS cannot be fetched", () => mockVerify.mockRejectedValue(new jwtErrors.FetchError('https://cognito/jwks.json', 'timeout'))],
    ['the signing key is not in the cached JWKS yet', () => mockVerify.mockRejectedValue(new jwtErrors.KidNotFoundInJwksError('JWK for kid not found'))],
    ['a JWKS refetch is rate-limited', () => mockVerify.mockRejectedValue(new jwtErrors.WaitPeriodNotYetEndedJwkError('Not allowed to fetch JWKS yet'))],
    ['the JWKS is not cached', () => mockVerify.mockRejectedValue(new jwtErrors.JwksNotAvailableInCacheError('JWKS not available in cache'))],
    ['the verifier is not configured', () => { delete process.env.PUBLIC_USER_POOL_CLIENT_ID; }],
  ])('refuses with a retryable 503 when %s', async (_, arrange) => {
    arrange();
    const res = await handler(join({}), {});
    refusedWith(res, 503, 'ACCOUNT_CHECK_UNAVAILABLE');
    expect(body(res).msg).toBe("We couldn't check your account. Try again in a moment.");
  });

  it('returns an existing entry without checking the ID token again', async () => {
    db.queryEntriesByUserId.mockResolvedValue([{ pk: queueId, status: 'admitted', joinedAt: 1782900000 }]);
    const res = await handler(join({}, {}), {});
    expect(res.statusCode).toBe(200);
    expect(body(res).data.status).toBe('admitted');
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
