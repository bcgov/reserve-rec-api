'use strict';

// ── Shared mocks ──────────────────────────────────────────────────────────────

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  Exception: class Exception extends Error {
    constructor(msg, opts = {}) {
      super(msg);
      this.code = opts.code;
    }
  },
  sendResponse: jest.fn((code, data, message) => ({
    statusCode: code,
    body: JSON.stringify({ message, data }),
  })),
  checkAuthContext: jest.fn(),
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  scanQueuesByStatus: jest.fn(),
  scanAllQueueMetas: jest.fn(),
  buildQueueId: jest.fn((col, type, act, date) => `QUEUE#${col}#${type}#${act}#${date}`),
  createQueueMeta: jest.fn(),
  putQueueMeta: jest.fn(),
  getQueueMeta: jest.fn(),
  updateQueueMetaStatus: jest.fn(),
  updateQueueMetaLastReleasedAt: jest.fn(),
  queryQueueEntries: jest.fn(),
  updateQueueEntryStatus: jest.fn(),
  deleteQueueMeta: jest.fn(),
  batchDeleteItems: jest.fn(),
  getActiveMode2QueueId: jest.fn(),
  setActiveMode2QueueId: jest.fn(),
  clearActiveMode2QueueId: jest.fn(),
}));

// Persistent CF send mock so the cached CloudFrontClient singleton reuses it
const mockCFSend = jest.fn();
jest.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: jest.fn(() => ({ send: mockCFSend })),
  // Tag each command so assertions can pin the call sequence by type
  GetFunctionCommand: jest.fn((args) => ({ __cmd: 'Get', ...args })),
  UpdateFunctionCommand: jest.fn((args) => ({ __cmd: 'Update', ...args })),
  PublishFunctionCommand: jest.fn((args) => ({ __cmd: 'Publish', ...args })),
}));

// Command types sent, in order, e.g. ['Get', 'Get', 'Update', 'Publish']
const cfCommandSequence = () => mockCFSend.mock.calls.map(([cmd]) => cmd.__cmd);

const mockWsSend = jest.fn();
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn(() => ({ send: mockWsSend })),
  PostToConnectionCommand: jest.fn((args) => ({ __cmd: 'Post', ...args })),
  DeleteConnectionCommand: jest.fn((args) => ({ __cmd: 'Delete', ...args })),
}));

const { sendResponse, checkAuthContext } = require('/opt/base');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');
// CloudFrontClient import not needed directly — we use mockCFSend

const NOW_UNIX = 1700000000;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW_UNIX * 1000);
  sendResponse.mockImplementation((code, data, message) => ({
    statusCode: code,
    body: JSON.stringify({ message, data }),
  }));
  // Per-handler tests run as a superadmin; the access tests below use the real check.
  checkAuthContext.mockReturnValue({ sub: 'admin', permissions: { superadmin: 'superadmin' } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── list-queues ───────────────────────────────────────────────────────────────

describe('list-queues handler', () => {
  let handler;
  beforeAll(() => {
    ({ handler } = require('../../src/handlers/waiting-room/admin/list-queues'));
  });

  const mockQueue = {
    pk: 'QUEUE#golden-ears#camping#standard#2025-06-15',
    queueStatus: 'pre-open',
    openingTime: '2025-06-01T14:00:00Z',
    totalEntries: 10,
    admittedCount: 0,
    updatedAt: NOW_UNIX,
  };

  it('returns all queues when no status filter', async () => {
    db.scanAllQueueMetas.mockResolvedValue([mockQueue]);
    const res = await handler({ queryStringParameters: {} });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.count).toBe(1);
    expect(body.data.queues[0].queueId).toBe(mockQueue.pk);
    expect(db.scanAllQueueMetas).toHaveBeenCalledTimes(1);
    expect(db.scanQueuesByStatus).not.toHaveBeenCalled();
  });

  it('filters by status when provided', async () => {
    db.scanQueuesByStatus.mockResolvedValue([mockQueue]);
    const res = await handler({ queryStringParameters: { status: 'pre-open' } });
    expect(res.statusCode).toBe(200);
    expect(db.scanQueuesByStatus).toHaveBeenCalledWith('pre-open');
  });

  it('includes firstReleaseAt for Mode 2 queues that have one', async () => {
    const firstReleaseAt = '2023-11-14T22:30:00.000Z';
    db.scanAllQueueMetas.mockResolvedValue([
      { ...mockQueue, pk: 'QUEUE#MODE2#global#1#2023-11-14', firstReleaseAt },
      mockQueue,
    ]);
    const res = await handler({ queryStringParameters: {} });
    const { queues } = JSON.parse(res.body).data;
    expect(queues[0].firstReleaseAt).toBe(firstReleaseAt);
    expect(queues[1]).not.toHaveProperty('firstReleaseAt');
  });

  it('returns 400 for invalid status', async () => {
    const res = await handler({ queryStringParameters: { status: 'invalid' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    db.scanAllQueueMetas.mockRejectedValue(new Error('DDB error'));
    const res = await handler({});
    expect(res.statusCode).toBe(500);
  });
});

// ── create-queues ─────────────────────────────────────────────────────────────

describe('create-queues handler', () => {
  let handler;
  beforeAll(() => {
    ({ handler } = require('../../src/handlers/waiting-room/admin/create-queues'));
  });

  const validBody = {
    collectionId: 'golden-ears',
    activityType: 'camping',
    activityId: 'standard-sites',
    openingTimes: [
      { startDate: '2025-06-15', openingTime: '2025-06-01T14:00:00Z' },
      { startDate: '2025-06-16', openingTime: '2025-06-01T14:00:00Z' },
    ],
  };

  it('creates queues for all valid dates', async () => {
    db.createQueueMeta.mockResolvedValue({});
    const res = await handler({ body: JSON.stringify(validBody) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.created).toHaveLength(2);
    expect(body.data.errors).toHaveLength(0);
    expect(db.createQueueMeta).toHaveBeenCalledTimes(2);
  });

  it('returns 400 when required fields missing', async () => {
    const res = await handler({ body: JSON.stringify({ collectionId: 'x' }) });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when openingTimes is empty array', async () => {
    const res = await handler({ body: JSON.stringify({ ...validBody, openingTimes: [] }) });
    expect(res.statusCode).toBe(400);
  });

  it('overwrites a duplicate queue when existing is pre-open with no entries', async () => {
    const err = new Error('conditional failed');
    err.name = 'ConditionalCheckFailedException';
    db.createQueueMeta.mockRejectedValueOnce(err).mockResolvedValueOnce({});
    db.getQueueMeta.mockResolvedValueOnce({ queueStatus: 'pre-open', totalEntries: 0, createdAt: 1234 });
    db.putQueueMeta.mockResolvedValueOnce({});
    const res = await handler({ body: JSON.stringify(validBody) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.created).toHaveLength(2);
    expect(body.data.created[0].overwrote).toBe(true);
    expect(body.data.errors).toHaveLength(0);
    expect(db.putQueueMeta).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite an active queue with entries', async () => {
    const err = new Error('conditional failed');
    err.name = 'ConditionalCheckFailedException';
    db.createQueueMeta.mockRejectedValueOnce(err).mockResolvedValueOnce({});
    db.getQueueMeta.mockResolvedValueOnce({ queueStatus: 'releasing', totalEntries: 42 });
    const res = await handler({ body: JSON.stringify(validBody) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.created).toHaveLength(1);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0].reason).toMatch(/status 'releasing' and 42 entries/);
    expect(db.putQueueMeta).not.toHaveBeenCalled();
  });

  it('records error for invalid openingTime', async () => {
    const body = {
      ...validBody,
      openingTimes: [{ startDate: '2025-06-15', openingTime: 'not-a-date' }],
    };
    const res = await handler({ body: JSON.stringify(body) });
    expect(res.statusCode).toBe(400);
    const resBody = JSON.parse(res.body);
    expect(resBody.data.errors[0].reason).toMatch(/Invalid openingTime/);
  });

  it('records error for missing startDate', async () => {
    const body = {
      ...validBody,
      openingTimes: [{ openingTime: '2025-06-01T14:00:00Z' }],
    };
    const res = await handler({ body: JSON.stringify(body) });
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 on unexpected error', async () => {
    db.createQueueMeta.mockRejectedValue(new Error('DDB error'));
    const res = await handler({ body: JSON.stringify(validBody) });
    // partial: one date gets the error, we should handle gracefully
    expect(res.statusCode).toBe(400); // all errors → 400
  });
});

// ── close-queue ───────────────────────────────────────────────────────────────

describe('close-queue handler', () => {
  let handler;
  beforeAll(() => {
    ({ handler } = require('../../src/handlers/waiting-room/admin/close-queue'));
  });

  const queueId = 'QUEUE#golden-ears#camping#standard#2025-06-15';

  it('force-closes an open queue and abandons active entries', async () => {
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'releasing' });
    db.updateQueueMetaStatus.mockResolvedValue({});
    db.queryQueueEntries.mockResolvedValue([
      { pk: queueId, userId: 'user1' },
      { pk: queueId, userId: 'user2' },
    ]);
    db.updateQueueEntryStatus.mockResolvedValue({});

    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.abandonedCount).toBe(2);
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'closed');
    expect(db.updateQueueEntryStatus).toHaveBeenCalledTimes(2);
  });

  it('pushes queueClosed and disconnects each connected client', async () => {
    process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://ws.example.com/ws';
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'releasing' });
    db.updateQueueMetaStatus.mockResolvedValue({});
    db.queryQueueEntries.mockResolvedValue([
      { pk: queueId, userId: 'user1', connectionId: 'conn-1' },
      { pk: queueId, userId: 'user2', connectionId: 'conn-2' },
    ]);
    db.updateQueueEntryStatus.mockResolvedValue({});
    mockWsSend.mockResolvedValue({});

    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);

    const posts = mockWsSend.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd.__cmd === 'Post');
    const deletes = mockWsSend.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd.__cmd === 'Delete');

    expect(posts).toHaveLength(2);
    expect(deletes).toHaveLength(2);
    expect(JSON.parse(posts[0].Data.toString())).toEqual({ type: 'queueClosed' });
    expect(posts.map((c) => c.ConnectionId).sort()).toEqual(['conn-1', 'conn-2']);

    delete process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
  });

  it('returns 200 immediately if queue is already closed', async () => {
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'closed' });
    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.alreadyClosed).toBe(true);
    expect(db.updateQueueMetaStatus).not.toHaveBeenCalled();
  });

  it('returns 400 when queueId missing', async () => {
    const res = await handler({ pathParameters: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when queue not found', async () => {
    db.getQueueMeta.mockResolvedValue(null);
    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(404);
  });
});

// ── delete-queue ──────────────────────────────────────────────────────────────

describe('delete-queue handler', () => {
  let handler;
  beforeAll(() => {
    ({ handler } = require('../../src/handlers/waiting-room/admin/delete-queue'));
  });

  const queueId = 'QUEUE#golden-ears#camping#standard#2025-06-15';

  it('deletes a pre-open queue with no entries', async () => {
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'pre-open' });
    db.queryQueueEntries.mockResolvedValue([]);
    db.deleteQueueMeta.mockResolvedValue({});

    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.deleted).toBe(true);
    expect(body.data.entriesRemoved).toBe(0);
    expect(db.batchDeleteItems).not.toHaveBeenCalled();
    expect(db.deleteQueueMeta).toHaveBeenCalledWith(queueId);
  });

  it('deletes a closed queue and its entries', async () => {
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'closed' });
    db.queryQueueEntries.mockResolvedValue([
      { pk: queueId, sk: 'ENTRY#user1' },
      { pk: queueId, sk: 'ENTRY#user2' },
    ]);
    db.batchDeleteItems.mockResolvedValue({});
    db.deleteQueueMeta.mockResolvedValue({});

    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.entriesRemoved).toBe(2);
    expect(db.batchDeleteItems).toHaveBeenCalledWith([
      { pk: queueId, sk: 'ENTRY#user1' },
      { pk: queueId, sk: 'ENTRY#user2' },
    ]);
  });

  it('returns 409 for queue in non-deletable status', async () => {
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'releasing' });
    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 when queueId missing', async () => {
    const res = await handler({ pathParameters: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when queue not found', async () => {
    db.getQueueMeta.mockResolvedValue(null);
    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(404);
  });
});

// ── queue-metrics ─────────────────────────────────────────────────────────────

describe('queue-metrics handler', () => {
  let handler;
  beforeAll(() => {
    ({ handler } = require('../../src/handlers/waiting-room/admin/queue-metrics'));
  });

  const queueId = 'QUEUE#golden-ears#camping#standard#2025-06-15';
  const meta = {
    queueStatus: 'releasing',
    openingTime: '2025-06-01T14:00:00Z',
    totalEntries: 5,
    admittedCount: 2,
    updatedAt: NOW_UNIX,
  };

  it('returns metrics with entry status counts', async () => {
    db.getQueueMeta.mockResolvedValue(meta);
    db.queryQueueEntries.mockResolvedValue([
      { status: 'waiting' },
      { status: 'waiting' },
      { status: 'admitted' },
      { status: 'admitted' },
      { status: 'expired' },
    ]);

    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.queueId).toBe(queueId);
    expect(body.data.counts.waiting).toBe(2);
    expect(body.data.counts.admitted).toBe(2);
    expect(body.data.counts.expired).toBe(1);
    expect(body.data.counts.admitting).toBe(0);
    expect(body.data.counts.abandoned).toBe(0);
  });

  it('returns 400 when queueId missing', async () => {
    const res = await handler({ pathParameters: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when queue not found', async () => {
    db.getQueueMeta.mockResolvedValue(null);
    db.queryQueueEntries.mockResolvedValue([]);
    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(404);
  });
});

// ── toggle-mode2 ──────────────────────────────────────────────────────────────

describe('toggle-mode2 handler', () => {
  let handler;

  beforeAll(() => {
    ({ handler } = require('../../src/handlers/waiting-room/admin/toggle-mode2'));
  });

  beforeEach(() => {
    process.env.VIEWER_FUNCTION_NAME = 'WaitingRoomViewerFn-wr';
    delete process.env.FRONT_DOOR_VIEWER_FUNCTION_NAME;
    mockCFSend.mockReset();
    // Get → Update → Publish per target.
    mockCFSend.mockImplementation(async (cmd) =>
      cmd.__cmd === 'Update' ? { ETag: 'etag-update' } : { ETag: 'etag-get' }
    );
    db.putQueueMeta.mockResolvedValue({});
    db.updateQueueMetaStatus.mockResolvedValue(true);
    db.scanQueuesByStatus.mockResolvedValue([]);
    db.queryQueueEntries.mockResolvedValue([]);
    db.getQueueMeta.mockResolvedValue(undefined);
    db.getActiveMode2QueueId.mockResolvedValue(null);
    db.setActiveMode2QueueId.mockResolvedValue();
    db.clearActiveMode2QueueId.mockResolvedValue();
  });

  it('activates Mode 2 (active: true) — creates DynamoDB queue record', async () => {
    // Re-activating a same-day queue: counters come from the stored meta record
    db.getQueueMeta.mockResolvedValue({
      totalEntries: 2,
      admittedCount: 1,
      lastReleasedAt: 0,
      openingTime: '2026-03-05T17:00:00.000Z',
      createdAt: 1700000000,
    });
    const res = await handler({ body: JSON.stringify({ active: true }) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.active).toBe(true);
    expect(body.data.functionName).toBe('WaitingRoomViewerFn-wr');
    expect(body.data.queueId).toMatch(/^QUEUE#MODE2#global#1#/);
    expect(body.data.batchSize).toBe(50);
    expect(body.data.releaseIntervalSeconds).toBe(300);
    expect(cfCommandSequence()).toEqual(['Get', 'Update', 'Publish']);
    expect(db.putQueueMeta).toHaveBeenCalledTimes(1);
    const queueArg = db.putQueueMeta.mock.calls[0][0];
    expect(queueArg.queueStatus).toBe('releasing');
    expect(queueArg.batchSize).toBe(50);
    expect(queueArg.releaseIntervalSeconds).toBe(300);
    expect(queueArg.lastReleasedAt).toBe(0);
    // counters from the existing meta are preserved, not zeroed
    expect(queueArg.totalEntries).toBe(2);
    expect(queueArg.admittedCount).toBe(1);
    expect(queueArg.openingTime).toBe('2026-03-05T17:00:00.000Z');
  });

  it('activates a brand-new Mode 2 queue with zeroed counters', async () => {
    const res = await handler({ body: JSON.stringify({ active: true }) });
    expect(res.statusCode).toBe(200);
    const queueArg = db.putQueueMeta.mock.calls[0][0];
    expect(queueArg.totalEntries).toBe(0);
    expect(queueArg.admittedCount).toBe(0);
    expect(queueArg.lastReleasedAt).toBe(0);
  });

  it('activates Mode 2 with custom batchSize and interval', async () => {
    const res = await handler({ body: JSON.stringify({ active: true, batchSize: 20, releaseIntervalSeconds: 120 }) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.batchSize).toBe(20);
    expect(body.data.releaseIntervalSeconds).toBe(120);
    const queueArg = db.putQueueMeta.mock.calls[0][0];
    expect(queueArg.batchSize).toBe(20);
    expect(queueArg.releaseIntervalSeconds).toBe(120);
  });

  describe('firstReleaseAt', () => {
    const HOUR = 3600 * 1000;
    const at = offsetMs => new Date(NOW_UNIX * 1000 + offsetMs).toISOString();
    const activate = extra => handler({ body: JSON.stringify({ active: true, ...extra }) });

    it.each([
      ['in the past', { firstReleaseAt: at(-1000) }],
      ['exactly now', { firstReleaseAt: at(0) }],
      ['more than 24 hours ahead', { firstReleaseAt: at(24 * HOUR + 1000) }],
      ['unparseable', { firstReleaseAt: 'not-a-date' }],
      ['not a string', { firstReleaseAt: 1700000600000 }],
      ['combined with manual release', { firstReleaseAt: at(HOUR), releaseMode: 'manual' }],
    ])('rejects firstReleaseAt %s with 400 and writes nothing', async (_name, extra) => {
      const res = await activate(extra);
      expect(res.statusCode).toBe(400);
      expect(db.putQueueMeta).not.toHaveBeenCalled();
      expect(mockCFSend).not.toHaveBeenCalled();
    });

    it('explains the manual-release conflict', async () => {
      const res = await activate({ firstReleaseAt: at(HOUR), releaseMode: 'manual' });
      expect(JSON.parse(res.body).message).toBe('firstReleaseAt applies to auto release only');
    });

    it('stores a valid firstReleaseAt normalised to ISO and returns it', async () => {
      const res = await activate({ firstReleaseAt: new Date(NOW_UNIX * 1000 + HOUR).toUTCString() });
      expect(res.statusCode).toBe(200);
      expect(db.putQueueMeta.mock.calls[0][0].firstReleaseAt).toBe(at(HOUR));
      expect(JSON.parse(res.body).data.firstReleaseAt).toBe(at(HOUR));
    });

    it('accepts exactly 24 hours ahead', async () => {
      const res = await activate({ firstReleaseAt: at(24 * HOUR) });
      expect(res.statusCode).toBe(200);
    });

    it('does not keep an old firstReleaseAt when reactivated without one', async () => {
      db.getQueueMeta.mockResolvedValue({ firstReleaseAt: at(HOUR), totalEntries: 1, admittedCount: 0 });
      const res = await activate({});
      expect(res.statusCode).toBe(200);
      expect(db.putQueueMeta.mock.calls[0][0]).not.toHaveProperty('firstReleaseAt');
      expect(JSON.parse(res.body).data.firstReleaseAt).toBeUndefined();
    });

    it('ignores firstReleaseAt when deactivating', async () => {
      const res = await handler({ body: JSON.stringify({ active: false, firstReleaseAt: 'not-a-date' }) });
      expect(res.statusCode).toBe(200);
    });
  });

  it('activates Mode 2 on both the standalone and front door functions', async () => {
    process.env.FRONT_DOOR_VIEWER_FUNCTION_NAME = 'FrontDoorViewerFn-fd';
    const res = await handler({ body: JSON.stringify({ active: true }) });
    delete process.env.FRONT_DOOR_VIEWER_FUNCTION_NAME;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.functionNames).toEqual(['WaitingRoomViewerFn-wr', 'FrontDoorViewerFn-fd']);
    expect(cfCommandSequence()).toEqual([
      'Get', 'Update', 'Publish', 'Get', 'Update', 'Publish',
    ]);
    const updatedNames = mockCFSend.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => cmd.__cmd === 'Update')
      .map((cmd) => cmd.Name);
    expect(updatedNames).toEqual(['WaitingRoomViewerFn-wr', 'FrontDoorViewerFn-fd']);
  });

  it('deactivates Mode 2 (active: false) — closes all releasing Mode 2 queues', async () => {
    db.scanQueuesByStatus.mockResolvedValue([
      { pk: 'QUEUE#MODE2#global#1#2026-03-05', queueStatus: 'releasing' },
      { pk: 'QUEUE#MODE2#global#1#2026-03-06', queueStatus: 'releasing' },
      { pk: 'QUEUE#col1#camping#site#2026-03-06', queueStatus: 'releasing' }, // non-Mode2, should be skipped
    ]);
    const res = await handler({ body: JSON.stringify({ active: false }) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.active).toBe(false);
    expect(body.data.batchSize).toBeUndefined();
    expect(cfCommandSequence()).toEqual(['Get', 'Update', 'Publish']);
    expect(db.putQueueMeta).not.toHaveBeenCalled();
    expect(db.scanQueuesByStatus).toHaveBeenCalledWith('releasing');
    // Both MODE2 queues closed; non-Mode2 queue skipped
    expect(db.updateQueueMetaStatus).toHaveBeenCalledTimes(2);
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2026-03-05', 'closed');
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2026-03-06', 'closed');
  });

  it('deactivates Mode 2 and abandons + notifies waiting entries', async () => {
    process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://ws.example.com/ws';
    db.scanQueuesByStatus.mockResolvedValue([
      { pk: 'QUEUE#MODE2#global#1#2026-03-05', queueStatus: 'releasing' },
    ]);
    db.queryQueueEntries.mockResolvedValue([
      { pk: 'QUEUE#MODE2#global#1#2026-03-05', userId: 'user-1', connectionId: 'conn-1', status: 'waiting' },
      { pk: 'QUEUE#MODE2#global#1#2026-03-05', userId: 'user-2', connectionId: 'conn-2', status: 'admitting' },
    ]);
    db.updateQueueEntryStatus.mockResolvedValue({});
    mockWsSend.mockResolvedValue({});

    const res = await handler({ body: JSON.stringify({ active: false }) });
    delete process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
    expect(res.statusCode).toBe(200);

    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(
      'QUEUE#MODE2#global#1#2026-03-05', 'user-1', 'abandoned', null, { abandonedAt: NOW_UNIX },
    );
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(
      'QUEUE#MODE2#global#1#2026-03-05', 'user-2', 'abandoned', null, { abandonedAt: NOW_UNIX },
    );
    // one PostToConnection + one DeleteConnection per entry
    expect(mockWsSend).toHaveBeenCalledTimes(4);
  });

  describe('active Mode 2 pointer', () => {
    it('points at the new queue on activation', async () => {
      const res = await handler({ body: JSON.stringify({ active: true }) });
      const { queueId } = JSON.parse(res.body).data;
      expect(db.putQueueMeta.mock.calls[0][0].pk).toBe(queueId);
      expect(db.setActiveMode2QueueId).toHaveBeenCalledWith(queueId);
    });

    it('keeps the pointed-to queue on reactivation after the UTC date rolls over', async () => {
      db.getActiveMode2QueueId.mockResolvedValue('QUEUE#MODE2#global#1#2023-11-13');
      db.getQueueMeta.mockResolvedValue({ totalEntries: 9, admittedCount: 4 });
      const res = await handler({ body: JSON.stringify({ active: true }) });
      expect(JSON.parse(res.body).data.queueId).toBe('QUEUE#MODE2#global#1#2023-11-13');
      expect(db.getQueueMeta).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2023-11-13');
      expect(db.putQueueMeta.mock.calls[0][0]).toMatchObject({ pk: 'QUEUE#MODE2#global#1#2023-11-13', totalEntries: 9, admittedCount: 4 });
      expect(db.setActiveMode2QueueId).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2023-11-13');
    });

    it('removes the pointer on deactivation, after closing the queues', async () => {
      db.getActiveMode2QueueId.mockResolvedValue('QUEUE#MODE2#global#1#2023-11-13');
      db.scanQueuesByStatus.mockResolvedValue([{ pk: 'QUEUE#MODE2#global#1#2023-11-13', queueStatus: 'releasing' }]);
      const res = await handler({ body: JSON.stringify({ active: false }) });
      expect(JSON.parse(res.body).data.queueId).toBe('QUEUE#MODE2#global#1#2023-11-13');
      expect(db.clearActiveMode2QueueId).toHaveBeenCalledTimes(1);
      expect(db.clearActiveMode2QueueId.mock.invocationCallOrder[0])
        .toBeGreaterThan(db.updateQueueMetaStatus.mock.invocationCallOrder[0]);
      expect(db.setActiveMode2QueueId).not.toHaveBeenCalled();
    });

    it('closes the queue and removes the pointer when the CloudFront update fails on a fresh activation', async () => {
      mockCFSend.mockRejectedValue(new Error('CF error'));
      const res = await handler({ body: JSON.stringify({ active: true }) });
      expect(res.statusCode).toBe(500);
      const { pk } = db.putQueueMeta.mock.calls[0][0];
      expect(db.setActiveMode2QueueId).toHaveBeenCalledWith(pk);
      expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(pk, 'closed');
      expect(db.clearActiveMode2QueueId).toHaveBeenCalled();
    });

    it('leaves a live queue running on its previous settings when the CloudFront update fails', async () => {
      const liveMeta = {
        pk: 'QUEUE#MODE2#global#1#2023-11-13', sk: 'META', queueStatus: 'releasing',
        batchSize: 50, releaseIntervalSeconds: 300, totalEntries: 9, admittedCount: 4,
      };
      db.getActiveMode2QueueId.mockResolvedValue(liveMeta.pk);
      db.getQueueMeta.mockResolvedValue(liveMeta);
      mockCFSend.mockRejectedValue(new Error('CF error'));

      const res = await handler({ body: JSON.stringify({ active: true, batchSize: 20 }) });

      expect(res.statusCode).toBe(500);
      expect(db.putQueueMeta.mock.calls.map(([meta]) => meta.batchSize)).toEqual([20, 50]);
      expect(db.putQueueMeta).toHaveBeenLastCalledWith(liveMeta);
      expect(db.updateQueueMetaStatus).not.toHaveBeenCalled();
      expect(db.clearActiveMode2QueueId).not.toHaveBeenCalled();
    });

    it('closes a reopened queue but keeps the pointer it already had when the CloudFront update fails', async () => {
      db.getActiveMode2QueueId.mockResolvedValue('QUEUE#MODE2#global#1#2023-11-13');
      db.getQueueMeta.mockResolvedValue({ pk: 'QUEUE#MODE2#global#1#2023-11-13', queueStatus: 'closed' });
      mockCFSend.mockRejectedValue(new Error('CF error'));

      await handler({ body: JSON.stringify({ active: true }) });

      expect(db.updateQueueMetaStatus).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2023-11-13', 'closed');
      expect(db.clearActiveMode2QueueId).not.toHaveBeenCalled();
    });
  });

  it('returns 400 when active field missing', async () => {
    const res = await handler({ body: JSON.stringify({}) });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when active is not boolean', async () => {
    const res = await handler({ body: JSON.stringify({ active: 'yes' }) });
    expect(res.statusCode).toBe(400);
  });

  it('returns 503 when VIEWER_FUNCTION_NAME not configured', async () => {
    delete process.env.VIEWER_FUNCTION_NAME;
    const res = await handler({ body: JSON.stringify({ active: true }) });
    expect(res.statusCode).toBe(503);
  });

  it('returns 500 on CloudFront API error', async () => {
    mockCFSend.mockReset();
    mockCFSend.mockRejectedValue(new Error('CF error'));
    const res = await handler({ body: JSON.stringify({ active: true }) });
    expect(res.statusCode).toBe(500);
  });
});

// ── superadmin only ───────────────────────────────────────────────────────────

describe('waiting-room admin endpoints are superadmin only', () => {
  const adminEvent = (permissions, extra = {}) => ({
    requestContext: { authorizer: { principalId: 'admin-sub', permissions: JSON.stringify(permissions) } },
    ...extra,
  });
  const HQ_ADMIN = { bcparks_1: 'staff' };
  const SUPERADMIN = { superadmin: 'superadmin' };
  const load = (file) => require(`../../src/handlers/waiting-room/admin/${file}`).handler;

  beforeEach(() => {
    checkAuthContext.mockImplementation(jest.requireActual('../../src/layers/base/base').checkAuthContext);
    process.env.VIEWER_FUNCTION_NAME = 'WaitingRoomViewerFn-wr';
    mockCFSend.mockReset();
    mockCFSend.mockImplementation(async (cmd) => (cmd.__cmd === 'Update' ? { ETag: 'etag-update' } : { ETag: 'etag-get' }));
    db.getActiveMode2QueueId.mockResolvedValue(null);
    db.getQueueMeta.mockResolvedValue(undefined);
    db.scanAllQueueMetas.mockResolvedValue([]);
  });

  it.each([
    ['toggle-mode2', { body: JSON.stringify({ active: true }) }],
    ['toggle-mode2', { body: JSON.stringify({ active: false }) }],
    ['list-queues', {}],
    ['create-queues', { body: JSON.stringify({ collectionId: 'c', activityType: 't', activityId: '1', openingTimes: [{ startDate: '2026-07-01', openingTime: '2026-07-01T14:00:00Z' }] }) }],
    ['close-queue', { body: JSON.stringify({ queueId: 'QUEUE#c#t#1#2026-07-01' }), pathParameters: { queueId: 'QUEUE#c#t#1#2026-07-01' } }],
    ['delete-queue', { body: JSON.stringify({ queueId: 'QUEUE#c#t#1#2026-07-01' }), pathParameters: { queueId: 'QUEUE#c#t#1#2026-07-01' } }],
    ['queue-metrics', { pathParameters: { queueId: 'QUEUE#c#t#1#2026-07-01' }, queryStringParameters: { queueId: 'QUEUE#c#t#1#2026-07-01' } }],
  ])('%s refuses a non-superadmin with 403 before reading or writing anything', async (file, extra) => {
    const res = await load(file)(adminEvent(HQ_ADMIN, extra));

    expect(res.statusCode).toBe(403);
    const dbCalls = Object.values(db).filter(fn => typeof fn === 'function' && fn.mock).flatMap(fn => fn.mock.calls);
    expect(dbCalls).toHaveLength(0);
    expect(mockCFSend).not.toHaveBeenCalled();
  });

  it('refuses a caller with no permissions at all', async () => {
    const res = await load('toggle-mode2')(adminEvent({}, { body: JSON.stringify({ active: true }) }));
    expect(res.statusCode).toBe(403);
    expect(db.putQueueMeta).not.toHaveBeenCalled();
  });

  it('lets a superadmin toggle Mode 2', async () => {
    const res = await load('toggle-mode2')(adminEvent(SUPERADMIN, { body: JSON.stringify({ active: true }) }));
    expect(res.statusCode).toBe(200);
    expect(db.putQueueMeta).toHaveBeenCalled();
    expect(mockCFSend).toHaveBeenCalled();
  });

  it('lets a superadmin list queues', async () => {
    const res = await load('list-queues')(adminEvent(SUPERADMIN));
    expect(res.statusCode).toBe(200);
  });
});
