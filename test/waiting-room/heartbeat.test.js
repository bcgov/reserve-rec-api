'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  Exception: class Exception extends Error {
    constructor(msg, opts = {}) {
      super(msg);
      this.code = opts.code;
      this.data = opts.data;
      this.errorCode = opts.errorCode;
    }
  },
  sendResponse: jest.fn((code, data, message) => ({
    statusCode: code,
    body: JSON.stringify({ message, data }),
  })),
  getRequestClaimsFromEvent: jest.fn(),
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getQueueEntry: jest.fn(),
  updateQueueEntryStatus: jest.fn(),
}));

jest.mock('../../src/handlers/waiting-room/utils/secrets', () => ({
  getHmacSigningKey: jest.fn(),
}));

jest.mock('../../src/handlers/waiting-room/utils/token', () => ({
  ...jest.requireActual('../../src/handlers/waiting-room/utils/token'),
  parseAdmissionCookie: jest.fn(),
  validateToken: jest.fn(),
}));

const { getRequestClaimsFromEvent } = require('/opt/base');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');
const secrets = require('../../src/handlers/waiting-room/utils/secrets');
const token = require('../../src/handlers/waiting-room/utils/token');
const { handler } = require('../../src/handlers/waiting-room/heartbeat/handler');
const realToken = jest.requireActual('../../src/handlers/waiting-room/utils/token');

const cookieMaxAge = (result) => Number(result.headers['Set-Cookie'].match(/Max-Age=(\d+)/)[1]);
const cookiePayload = (result) =>
  realToken.validateToken(realToken.parseAdmissionCookie(result.headers['Set-Cookie']), 'test-secret');
const storedExpiry = () => db.updateQueueEntryStatus.mock.calls[0][4].admissionExpiry;

const NOW = 1700000000;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);

  process.env.HMAC_SIGNING_KEY_ARN = 'arn:test';
  process.env.ADMISSION_TTL_MINUTES = '15';
  process.env.MAX_ADMISSION_MINUTES = '30';

  secrets.getHmacSigningKey.mockResolvedValue('test-secret');
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.HMAC_SIGNING_KEY_ARN;
  delete process.env.ADMISSION_TTL_MINUTES;
  delete process.env.MAX_ADMISSION_MINUTES;
});

const makeEvent = (overrides = {}) => ({
  headers: { cookie: 'bcparks-admission=valid-token' },
  body: JSON.stringify({ queueId: 'QUEUE#golden-ears#camping#standard#2025-06-15' }),
  ...overrides,
});

const validPayload = {
  sid: 'user-sub-123',
  fk: 'golden-ears#camping#standard',
  dk: '2025-06-15',
  iat: NOW - 300,
  exp: NOW + 600,
  nonce: 'abc123',
};

const admittedEntry = {
  pk: 'QUEUE#golden-ears#camping#standard#2025-06-15',
  sk: 'ENTRY#user-sub-123',
  userId: 'user-sub-123',
  status: 'admitted',
  facilityKey: 'golden-ears#camping#standard',
  dateKey: '2025-06-15',
  admittedAt: NOW - 300,
  admissionExpiry: NOW + 600,
};

describe('Heartbeat handler', () => {
  it('returns 401 when no Cognito auth', async () => {
    getRequestClaimsFromEvent.mockReturnValue(null);
    token.parseAdmissionCookie.mockReturnValue('valid-token');

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(401);
  });

  it('returns 401 when no admission cookie present', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue(null);

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('NO_TOKEN');
  });

  it('returns 403 EXPIRED when HMAC validation fails (invalid token)', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('bad-token');
    token.validateToken.mockReturnValue(null);

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('EXPIRED');
    expect(result.headers['Set-Cookie']).toMatch(/Max-Age=0/);
  });

  it('returns 403 USER_MISMATCH when token sub does not match authenticated user', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'different-user' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue({ ...validPayload, sid: 'user-sub-123' });

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('USER_MISMATCH');
  });

  it('returns 400 when queueId missing from body', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue(validPayload);

    const result = await handler(makeEvent({ body: JSON.stringify({}) }));
    expect(result.statusCode).toBe(400);
  });

  it('returns 403 EXPIRED when queue entry not found', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue(validPayload);
    db.getQueueEntry.mockResolvedValue(null);

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('EXPIRED');
  });

  it('returns 403 EXPIRED when queue entry status is not admitted', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue(validPayload);
    db.getQueueEntry.mockResolvedValue({ ...admittedEntry, status: 'expired' });

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('EXPIRED');
  });

  it('returns 403 MAX_TIME when absolute max admission time has been reached', async () => {
    // admittedAt such that now >= admittedAt + 30 min
    const admittedAt = NOW - 30 * 60;
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue({ ...validPayload, iat: admittedAt });
    db.getQueueEntry.mockResolvedValue({ ...admittedEntry, admittedAt });
    db.updateQueueEntryStatus.mockResolvedValue(true);

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('MAX_TIME');
    expect(result.headers['Set-Cookie']).toMatch(/Max-Age=0/);
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(
      'QUEUE#golden-ears#camping#standard#2025-06-15',
      'user-sub-123',
      'expired',
      'admitted',
    );
  });

  it('returns 200 with refreshed cookie on successful heartbeat', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue(validPayload);
    db.getQueueEntry.mockResolvedValue(admittedEntry);
    db.updateQueueEntryStatus.mockResolvedValue(true);

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(200);
    expect(cookiePayload(result)).toMatchObject({ sid: 'user-sub-123', exp: NOW + 900 });
    expect(cookieMaxAge(result)).toBe(900);
    expect(JSON.parse(result.body).tokenExpiry).toBe(NOW + 900);
    expect(storedExpiry()).toBe(NOW + 900);
  });

  it('returns 403 EXPIRED when concurrent update fails (conditional check failed)', async () => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue(validPayload);
    db.getQueueEntry.mockResolvedValue(admittedEntry);
    db.updateQueueEntryStatus.mockResolvedValue(false); // condition failed

    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.code).toBe('EXPIRED');
  });

  it('does not exceed MAX_ADMISSION_MINUTES absolute cap on new expiry', async () => {
    // admittedAt is 25 minutes ago; ADMISSION_TTL is 15 min → new expiry would be 15 min from now
    // but max is 30 min from admittedAt, so max = admittedAt + 30 min = 5 min from now
    const admittedAt = NOW - 25 * 60;
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue({ ...validPayload, iat: admittedAt });
    db.getQueueEntry.mockResolvedValue({ ...admittedEntry, admittedAt });
    db.updateQueueEntryStatus.mockResolvedValue(true);

    const result = await handler(makeEvent());

    const cap = admittedAt + 30 * 60;
    expect(JSON.parse(result.body).tokenExpiry).toBe(cap);
    expect(cookiePayload(result).exp).toBe(cap);
    expect(cookieMaxAge(result)).toBe(cap - NOW);
    expect(storedExpiry()).toBe(cap);
  });

  it.each([
    ['facility', { fk: 'other-park#camping#standard' }],
    ['date', { dk: '2025-06-16' }],
  ])('refuses without extending when the cookie is for another %s', async (_, otherQueue) => {
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-sub-123' });
    token.parseAdmissionCookie.mockReturnValue('valid-token');
    token.validateToken.mockReturnValue({ ...validPayload, ...otherQueue });
    db.getQueueEntry.mockResolvedValue(admittedEntry);
    db.updateQueueEntryStatus.mockResolvedValue(true);

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).code).toBe('QUEUE_MISMATCH');
    expect(db.updateQueueEntryStatus).not.toHaveBeenCalled();
  });
});
