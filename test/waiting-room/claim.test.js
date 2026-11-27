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

jest.mock('../../src/handlers/waiting-room/utils/secrets', () => ({
  getHmacSigningKey: jest.fn(() => Promise.resolve('test-hmac-key')),
}));

const { handler } = require('../../src/handlers/waiting-room/claim/handler');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');
const { getRequestClaimsFromEvent } = require('/opt/base');
const { validateToken, parseAdmissionCookie } = require('../../src/handlers/waiting-room/utils/token');

const queueId = 'QUEUE#golden-ears#camping#standard-sites#2025-06-15';
const now = 1700000000;

const cookieMaxAge = (result) => Number(result.headers['Set-Cookie'].match(/Max-Age=(\d+)/)[1]);
const cookiePayload = (result) => validateToken(parseAdmissionCookie(result.headers['Set-Cookie']), 'test-hmac-key');

const validEntry = {
  pk: queueId,
  sk: 'ENTRY#test-user-123',
  userId: 'test-user-123',
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
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    db.getQueueEntry.mockResolvedValue(validEntry);
    db.getQueueMeta.mockResolvedValue(validMeta);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    expect(cookiePayload(result)).toMatchObject({
      sid: 'test-user-123',
      fk: 'golden-ears#camping#standard-sites',
      dk: '2025-06-15',
    });
  });

  it('returns facilityKey, dateKey, tokenExpiry in response body', async () => {
    const result = await handler(makeEvent(), {});
    const body = JSON.parse(result.body);
    expect(body.facilityKey).toBe('golden-ears#camping#standard-sites');
    expect(body.dateKey).toBe('2025-06-15');
    expect(body.tokenExpiry).toBe(now + 900);
  });

  it('accepts entries in admitting status as well', async () => {
    db.getQueueEntry.mockResolvedValue({ ...validEntry, status: 'admitting' });
    const result = await handler(makeEvent(), {});
    expect(result.statusCode).toBe(200);
  });

  it('caps token, cookie and tokenExpiry at admissionExpiry on repeated claims', async () => {
    const admissionExpiry = now + 120;
    db.getQueueEntry.mockResolvedValue({ ...validEntry, admissionExpiry });

    const first = await handler(makeEvent(), {});
    Date.now.mockReturnValue((now + 60) * 1000);
    const second = await handler(makeEvent(), {});

    expect(JSON.parse(second.body).tokenExpiry).toBe(admissionExpiry);
    expect(cookiePayload(second).exp).toBe(admissionExpiry);
    expect(cookieMaxAge(second)).toBe(60);
    expect(cookiePayload(first).exp).toBe(admissionExpiry);
  });

  it('refuses a claim at the moment admissionExpiry is reached', async () => {
    db.getQueueEntry.mockResolvedValue({ ...validEntry, admissionExpiry: now });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(403);
  });
});
