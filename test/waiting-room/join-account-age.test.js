'use strict';

const mockCognitoSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  ...jest.requireActual('@aws-sdk/client-cognito-identity-provider'),
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
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
}));

const db = require('../../src/handlers/waiting-room/utils/dynamodb');

const NOW = Date.parse('2026-07-01T12:00:00Z');
const hoursAgo = (h) => Math.floor(NOW / 1000) - h * 3600;
const queueId = 'QUEUE#bcparks_7#dayuse#1#2026-07-02';
const join = (claims) => ({
  httpMethod: 'POST',
  body: JSON.stringify({ collectionId: 'bcparks_7', activityType: 'dayuse', activityId: '1', startDate: '2026-07-02' }),
  headers: { 'CloudFront-Viewer-Address': '1.2.3.4:443' },
  requestContext: { authorizer: { isAuthenticated: 'true', claims: { sub: 'sub-1', ...claims } } },
});
const body = (res) => JSON.parse(res.body);

function loadHandler(env) {
  Object.assign(process.env, env);
  let handler;
  jest.isolateModules(() => ({ handler } = require('../../src/handlers/waiting-room/join/handler')));
  return handler;
}

describe('WaitingRoom JOIN account age gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    db.getQueueMeta.mockResolvedValue({ pk: queueId, queueStatus: 'pre-open', openingTime: '2026-07-02T14:00:00Z' });
    db.queryEntriesByUserId.mockResolvedValue([]);
    db.queryEntriesByClientIp.mockResolvedValue([]);
    db.getQueueEntry.mockResolvedValue(null);
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.MIN_ACCOUNT_AGE_HOURS;
    delete process.env.COGNITO_USER_POOL_ID;
  });

  it('refuses an account younger than the minimum, using the creation-date claim', async () => {
    const handler = loadHandler({ MIN_ACCOUNT_AGE_HOURS: '24' });
    const res = await handler(join({ 'cognito:user_creation_date': hoursAgo(23) }), {});
    expect(res.statusCode).toBe(403);
    expect(body(res).msg).toBe('Account must be at least 24 hour(s) old to join a waiting room');
    expect(db.putQueueEntry).not.toHaveBeenCalled();
  });

  it('admits an account older than the minimum', async () => {
    const handler = loadHandler({ MIN_ACCOUNT_AGE_HOURS: '24' });
    const res = await handler(join({ 'cognito:user_creation_date': hoursAgo(25) }), {});
    expect(res.statusCode).toBe(200);
    expect(db.putQueueEntry).toHaveBeenCalledWith(expect.objectContaining({ pk: queueId, userId: 'sub-1', status: 'waiting', clientIp: '1.2.3.4' }));
  });

  it('falls back to the Cognito creation date when the claim is absent', async () => {
    const handler = loadHandler({ MIN_ACCOUNT_AGE_HOURS: '24', COGNITO_USER_POOL_ID: 'ca-central-1_pub' });
    mockCognitoSend.mockResolvedValue({ UserCreateDate: new Date(NOW - 2 * 3600 * 1000) });
    const res = await handler(join({}), {});
    expect(mockCognitoSend.mock.calls[0][0].input).toEqual({ UserPoolId: 'ca-central-1_pub', Username: 'sub-1' });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['the Cognito lookup fails', { COGNITO_USER_POOL_ID: 'ca-central-1_pub' }, () => mockCognitoSend.mockRejectedValue(new Error('throttled'))],
    ['no pool is configured', {}, () => {}],
  ])('skips the age check when %s', async (_, env, arrange) => {
    const handler = loadHandler({ MIN_ACCOUNT_AGE_HOURS: '24', ...env });
    arrange();
    const res = await handler(join({}), {});
    expect(res.statusCode).toBe(200);
    expect(db.putQueueEntry).toHaveBeenCalled();
  });

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
