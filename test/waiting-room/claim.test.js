'use strict';

jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.errorCode = data?.errorCode;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  sendResponse: jest.fn((status, data, message, error) => ({ status, data, message, error })),
  getRequestClaimsFromEvent: jest.fn(() => ({ sub: 'test-user-123' })),
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getQueueMeta: jest.fn(),
  getQueueEntry: jest.fn(),
}));

jest.mock('../../src/handlers/waiting-room/utils/token', () => ({
  generateToken: jest.fn(() => 'test-payload.test-signature'),
  buildAdmissionCookieHeader: jest.fn((token, ttl) => `bcparks-admission=${token}; HttpOnly; Max-Age=${ttl * 60}`),
}));

jest.mock('../../src/handlers/waiting-room/utils/secrets', () => ({
  getHmacSigningKey: jest.fn(() => Promise.resolve('test-hmac-key')),
}));

const { handler } = require('../../src/handlers/waiting-room/claim/handler');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');
const { sendResponse, getRequestClaimsFromEvent } = require('/opt/base');

const queueId = 'QUEUE#golden-ears#camping#standard-sites#2025-06-15';
const now = Math.floor(Date.now() / 1000);

const validEntry = {
  pk: queueId,
  sk: 'ENTRY#test-user-123',
  cognitoSub: 'test-user-123',
  status: 'admitted',
  facilityKey: 'golden-ears#camping#standard-sites',
  dateKey: '2025-06-15',
  admissionExpiry: now + 900,
  admittedAt: now - 30,
};

const validMeta = {
  pk: queueId,
  sk: 'META',
  queueStatus: 'releasing',
};

const makeEvent = (body = { queueId }) => ({
  body: JSON.stringify(body),
  headers: {},
});

describe('WaitingRoom CLAIM handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getQueueEntry.mockResolvedValue(validEntry);
    db.getQueueMeta.mockResolvedValue(validMeta);
  });

  it('returns 401 if not authenticated', async () => {
    getRequestClaimsFromEvent.mockReturnValueOnce(null);
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(401);
  });

  it('returns 400 if queueId is missing', async () => {
    const result = await handler(makeEvent({}), {});
    expect(result.status).toBe(400);
  });

  it('returns 404 if entry not found', async () => {
    db.getQueueEntry.mockResolvedValue(null);
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(404);
  });

  it('returns 403 NOT_ADMITTED if status is waiting', async () => {
    db.getQueueEntry.mockResolvedValue({ ...validEntry, status: 'waiting' });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(403);
  });

  it('returns 403 EXPIRED if status is expired', async () => {
    db.getQueueEntry.mockResolvedValue({ ...validEntry, status: 'expired' });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(403);
  });

  it('returns 403 EXPIRED if admissionExpiry has passed', async () => {
    db.getQueueEntry.mockResolvedValue({ ...validEntry, admissionExpiry: now - 10 });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(403);
  });

  it('returns 200 with Set-Cookie header on valid admitted entry', async () => {
    const result = await handler(makeEvent(), {});
    expect(result.statusCode).toBe(200);
    expect(result.headers['Set-Cookie']).toContain('bcparks-admission=test-payload.test-signature');
  });

  it('returns facilityKey, dateKey, tokenExpiry in response body', async () => {
    const result = await handler(makeEvent(), {});
    const body = JSON.parse(result.body);
    expect(body.facilityKey).toBe('golden-ears#camping#standard-sites');
    expect(body.dateKey).toBe('2025-06-15');
    expect(body.tokenExpiry).toBeGreaterThan(now);
  });

  it('accepts entries in admitting status as well', async () => {
    db.getQueueEntry.mockResolvedValue({ ...validEntry, status: 'admitting' });
    const result = await handler(makeEvent(), {});
    expect(result.statusCode).toBe(200);
  });

  it('is idempotent — re-calling returns fresh token', async () => {
    const { generateToken } = require('../../src/handlers/waiting-room/utils/token');
    generateToken.mockReturnValueOnce('new-payload.new-sig');
    const result = await handler(makeEvent(), {});
    expect(result.headers['Set-Cookie']).toContain('new-payload.new-sig');
  });
});
