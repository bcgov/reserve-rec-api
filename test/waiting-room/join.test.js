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
  getClientIp: jest.requireActual('../../src/layers/base/base').getClientIp,
  getHeaderValue: jest.requireActual('../../src/layers/base/base').getHeaderValue,
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  buildQueueId: jest.fn((c, at, ai, sd) => `QUEUE#${c}#${at}#${ai}#${sd}`),
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

jest.mock('/opt/cognito', () => ({ adminGetUser: jest.fn() }), { virtual: true });
const mockVerify = jest.fn();
jest.mock('aws-jwt-verify', () => ({ CognitoJwtVerifier: { create: () => ({ verify: (...args) => mockVerify(...args) }) } }));
process.env.PUBLIC_USER_POOL_ID = 'ca-central-1_pub';
process.env.PUBLIC_USER_POOL_CLIENT_ID = 'public-client';

const { handler } = require('../../src/handlers/waiting-room/join/handler');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');
const { sendResponse, getRequestClaimsFromEvent } = require('/opt/base');

const validBody = {
  collectionId: 'golden-ears',
  activityType: 'camping',
  activityId: 'standard-sites',
  startDate: '2025-06-15',
};

const validMeta = {
  pk: 'QUEUE#golden-ears#camping#standard-sites#2025-06-15',
  sk: 'META',
  queueStatus: 'pre-open',
  openingTime: new Date(Date.now() + 3600000).toISOString(),
  totalEntries: 0,
};

const makeEvent = (body = validBody, headers = {}) => ({
  body: JSON.stringify(body),
  headers: {
    'CloudFront-Viewer-Address': '1.2.3.4',
    'X-Id-Token': 'id-token',
    ...headers,
  },
});

describe('WaitingRoom JOIN handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getQueueMeta.mockResolvedValue(validMeta);
    db.queryEntriesByUserId.mockResolvedValue([]);
    db.queryEntriesByClientIp.mockResolvedValue([]);
    db.putQueueEntry.mockResolvedValue();
    db.incrementQueueTotalEntries.mockResolvedValue(1);
    db.abandonQueueEntry.mockResolvedValue(true);
    db.incrementAbandonedCount.mockResolvedValue();
    db.getActiveMode2QueueId.mockResolvedValue(null);
    db.getQueueEntry.mockResolvedValue(null);
    mockVerify.mockResolvedValue({ sub: 'test-user-123', email_verified: true });
  });

  it('returns 401 if not authenticated', async () => {
    getRequestClaimsFromEvent.mockReturnValueOnce(null);
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(401);
  });

  it('returns 400 if required fields are missing', async () => {
    const result = await handler({ body: JSON.stringify({ collectionId: 'x' }), headers: {} }, {});
    expect(result.status).toBe(400);
  });

  it('returns 404 if queue does not exist', async () => {
    db.getQueueMeta.mockResolvedValue(null);
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(404);
  });

  it('returns 410 if queue is closed', async () => {
    db.getQueueMeta.mockResolvedValue({ ...validMeta, queueStatus: 'closed' });
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(410);
  });

  it('returns 200 and existing entry data on idempotent re-join', async () => {
    const existingEntry = {
      pk: 'QUEUE#golden-ears#camping#standard-sites#2025-06-15',
      userId: 'test-user-123',
      status: 'waiting',
      joinedAt: 1000000,
    };
    db.queryEntriesByUserId.mockResolvedValue([existingEntry]);

    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(200);
    expect(result.data.status).toBe('waiting');
    // Should NOT create a new entry
    expect(db.putQueueEntry).not.toHaveBeenCalled();
  });

  it('abandons previous queue entry when joining a new queue', async () => {
    const otherQueueEntry = {
      pk: 'QUEUE#other#camping#sites#2025-06-16',
      userId: 'test-user-123',
      status: 'waiting',
      joinedAt: 1000000,
    };
    db.queryEntriesByUserId.mockResolvedValue([otherQueueEntry]);

    await handler(makeEvent(), {});
    expect(db.abandonQueueEntry).toHaveBeenCalledWith(otherQueueEntry.pk, 'test-user-123');
    expect(db.incrementAbandonedCount).toHaveBeenCalledWith(otherQueueEntry.pk, 1);
    expect(db.putQueueEntry).toHaveBeenCalled();
  });

  it('returns 429 when IP limit is exceeded', async () => {
    const ipEntries = Array(4).fill({ pk: 'QUEUE#...', userId: 'other-user', status: 'waiting' });
    db.queryEntriesByClientIp.mockResolvedValue(ipEntries);

    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(429);
  });

  it('keeps the place held in another queue when the IP limit refuses the join', async () => {
    db.queryEntriesByUserId.mockResolvedValue([{ pk: 'QUEUE#other#camping#sites#2025-06-16', status: 'waiting' }]);
    db.queryEntriesByClientIp.mockResolvedValue(Array(4).fill({ status: 'waiting' }));

    const result = await handler(makeEvent(), {});

    expect(result.status).toBe(429);
    expect(db.abandonQueueEntry).not.toHaveBeenCalled();
    expect(db.incrementAbandonedCount).not.toHaveBeenCalled();
  });

  describe('entry TTL', () => {
    const NOW = Date.parse('2026-07-02T12:00:00Z');
    beforeEach(() => jest.useFakeTimers({ now: NOW }));
    afterEach(() => jest.useRealTimers());
    const ttl = () => db.putQueueEntry.mock.calls[0][0].ttl;

    it('runs 25 hours from the opening time when the queue has not opened yet', async () => {
      db.getQueueMeta.mockResolvedValue({ ...validMeta, openingTime: '2026-07-02T14:00:00Z' });
      await handler(makeEvent(), {});
      expect(ttl()).toBe(Date.parse('2026-07-03T15:00:00Z') / 1000);
    });

    it('runs 25 hours from now for a queue opened more than 25 hours ago', async () => {
      db.getQueueMeta.mockResolvedValue({ ...validMeta, queueStatus: 'releasing', openingTime: '2026-07-01T05:00:00Z' });
      await handler(makeEvent(), {});
      expect(ttl()).toBe(NOW / 1000 + 25 * 3600);
    });
  });

  it('successfully creates a queue entry on valid join', async () => {
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(200);
    expect(db.putQueueEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'test-user-123',
        status: 'waiting',
        facilityKey: 'golden-ears#camping#standard-sites',
        dateKey: '2025-06-15',
      })
    );
    expect(db.incrementQueueTotalEntries).toHaveBeenCalled();
  });

  it('returns 200 with queue details', async () => {
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(200);
    expect(result.data.queueId).toBe('QUEUE#golden-ears#camping#standard-sites#2025-06-15');
    expect(result.data.openingTime).toBe(validMeta.openingTime);
    expect(result.data.queueStatus).toBe('pre-open');
  });

  describe('firstReleaseAt', () => {
    const firstReleaseAt = '2026-03-05T15:03:00.000Z';
    const mode2Body = { collectionId: 'MODE2', activityType: 'global', activityId: 1, startDate: '2026-03-05' };
    const mode2Meta = { ...validMeta, pk: 'QUEUE#MODE2#global#1#2026-03-05', queueStatus: 'releasing', firstReleaseAt };
    const existing = { pk: mode2Meta.pk, userId: 'test-user-123', status: 'waiting', joinedAt: 1000000 };

    beforeEach(() => {
      db.getActiveMode2QueueId.mockResolvedValue(mode2Meta.pk);
      db.getQueueMeta.mockResolvedValue(mode2Meta);
    });

    it('is returned when a user newly joins a Mode 2 queue', async () => {
      const result = await handler(makeEvent(mode2Body), {});
      expect(result.status).toBe(200);
      expect(result.data.firstReleaseAt).toBe(firstReleaseAt);
    });

    it('is returned on the already-joined path found by user lookup', async () => {
      db.queryEntriesByUserId.mockResolvedValue([existing]);
      const result = await handler(makeEvent(mode2Body), {});
      expect(result.data.firstReleaseAt).toBe(firstReleaseAt);
    });

    it('is returned on the already-joined path found by the strongly-consistent read', async () => {
      db.getQueueEntry.mockResolvedValue(existing);
      const result = await handler(makeEvent(mode2Body), {});
      expect(db.putQueueEntry).not.toHaveBeenCalled();
      expect(result.data.firstReleaseAt).toBe(firstReleaseAt);
    });

    it('is omitted when the Mode 2 queue has none', async () => {
      db.getQueueMeta.mockResolvedValue({ ...mode2Meta, firstReleaseAt: undefined });
      const result = await handler(makeEvent(mode2Body), {});
      expect(result.data).not.toHaveProperty('firstReleaseAt');
    });

    it('is never returned for Mode 1 queues', async () => {
      db.getQueueMeta.mockResolvedValue({ ...validMeta, firstReleaseAt });
      db.queryEntriesByUserId.mockResolvedValue([{ ...existing, pk: validMeta.pk }]);

      const rejoin = await handler(makeEvent(), {});
      expect(rejoin.data).not.toHaveProperty('firstReleaseAt');

      db.queryEntriesByUserId.mockResolvedValue([]);
      const fresh = await handler(makeEvent(), {});
      expect(fresh.data).not.toHaveProperty('firstReleaseAt');
    });
  });

  describe('Mode 2', () => {
    const pointedQueueId = 'QUEUE#MODE2#global#1#2026-03-05';
    const mode2Meta = { ...validMeta, pk: pointedQueueId, queueStatus: 'releasing', facilityKey: 'MODE2#global#1' };
    // The client sends UTC "today", which has already rolled over to the next day.
    const mode2Body = { collectionId: 'MODE2', activityType: 'global', activityId: 1, startDate: '2026-03-06' };

    it("joins the queue the pointer names, ignoring the client's startDate", async () => {
      db.getActiveMode2QueueId.mockResolvedValue(pointedQueueId);
      db.getQueueMeta.mockResolvedValue(mode2Meta);

      const result = await handler(makeEvent(mode2Body), {});

      expect(result.status).toBe(200);
      expect(result.data.queueId).toBe(pointedQueueId);
      expect(db.getQueueMeta).toHaveBeenCalledWith(pointedQueueId);
      expect(db.putQueueEntry).toHaveBeenCalledWith(expect.objectContaining({
        pk: pointedQueueId, facilityKey: 'MODE2#global#1', dateKey: '2026-03-05',
      }));
      expect(db.incrementQueueTotalEntries).toHaveBeenCalledWith(pointedQueueId);
    });

    it('returns 404 when Mode 2 is not active', async () => {
      const result = await handler(makeEvent(mode2Body), {});
      expect(result.status).toBe(404);
      expect(db.getQueueMeta).not.toHaveBeenCalled();
      expect(db.putQueueEntry).not.toHaveBeenCalled();
    });
  });
});
