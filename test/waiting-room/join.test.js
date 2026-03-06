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
  buildQueueId: jest.fn((c, at, ai, sd) => `QUEUE#${c}#${at}#${ai}#${sd}`),
  getQueueMeta: jest.fn(),
  getQueueEntry: jest.fn(),
  putQueueEntry: jest.fn(),
  incrementQueueTotalEntries: jest.fn(),
  queryEntriesByCognitoSub: jest.fn(),
  queryEntriesByClientIp: jest.fn(),
  abandonQueueEntry: jest.fn(),
  incrementAbandonedCount: jest.fn(),
}));

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
    ...headers,
  },
});

describe('WaitingRoom JOIN handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getQueueMeta.mockResolvedValue(validMeta);
    db.queryEntriesByCognitoSub.mockResolvedValue([]);
    db.queryEntriesByClientIp.mockResolvedValue([]);
    db.putQueueEntry.mockResolvedValue();
    db.incrementQueueTotalEntries.mockResolvedValue(1);
    db.abandonQueueEntry.mockResolvedValue(true);
    db.incrementAbandonedCount.mockResolvedValue();
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
      cognitoSub: 'test-user-123',
      status: 'waiting',
      joinedAt: 1000000,
    };
    db.queryEntriesByCognitoSub.mockResolvedValue([existingEntry]);

    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(200);
    expect(result.data.status).toBe('waiting');
    // Should NOT create a new entry
    expect(db.putQueueEntry).not.toHaveBeenCalled();
  });

  it('abandons previous queue entry when joining a new queue', async () => {
    const otherQueueEntry = {
      pk: 'QUEUE#other#camping#sites#2025-06-16',
      cognitoSub: 'test-user-123',
      status: 'waiting',
      joinedAt: 1000000,
    };
    db.queryEntriesByCognitoSub.mockResolvedValue([otherQueueEntry]);

    await handler(makeEvent(), {});
    expect(db.abandonQueueEntry).toHaveBeenCalledWith(otherQueueEntry.pk, 'test-user-123');
    expect(db.incrementAbandonedCount).toHaveBeenCalledWith(otherQueueEntry.pk, 1);
    expect(db.putQueueEntry).toHaveBeenCalled();
  });

  it('returns 429 when IP limit is exceeded', async () => {
    const ipEntries = Array(4).fill({ pk: 'QUEUE#...', cognitoSub: 'other-user', status: 'waiting' });
    db.queryEntriesByClientIp.mockResolvedValue(ipEntries);

    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(429);
  });

  it('successfully creates a queue entry on valid join', async () => {
    const result = await handler(makeEvent(), {});
    expect(result.status).toBe(200);
    expect(db.putQueueEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        cognitoSub: 'test-user-123',
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
});
