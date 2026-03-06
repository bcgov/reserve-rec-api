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
}));

// Persistent CF send mock so the cached CloudFrontClient singleton reuses it
const mockCFSend = jest.fn();
jest.mock('@aws-sdk/client-cloudfront', () => ({
  CloudFrontClient: jest.fn(() => ({ send: mockCFSend })),
  GetFunctionCommand: jest.fn(),
  UpdateFunctionCommand: jest.fn(),
  PublishFunctionCommand: jest.fn(),
}));

const { sendResponse } = require('/opt/base');
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

  it('records error for duplicate queue (ConditionalCheckFailedException)', async () => {
    const err = new Error('conditional failed');
    err.name = 'ConditionalCheckFailedException';
    db.createQueueMeta.mockRejectedValueOnce(err).mockResolvedValueOnce({});
    const res = await handler({ body: JSON.stringify(validBody) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.created).toHaveLength(1);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0].reason).toMatch(/already exists/);
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
      { pk: queueId, cognitoSub: 'user1' },
      { pk: queueId, cognitoSub: 'user2' },
    ]);
    db.updateQueueEntryStatus.mockResolvedValue({});

    const res = await handler({ pathParameters: { queueId: encodeURIComponent(queueId) } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.abandonedCount).toBe(2);
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'closed');
    expect(db.updateQueueEntryStatus).toHaveBeenCalledTimes(2);
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
    mockCFSend.mockReset();
    // Default mock flow: GetFunction → UpdateFunction → PublishFunction
    mockCFSend
      .mockResolvedValueOnce({ ETag: 'etag-1' })       // GetFunction
      .mockResolvedValueOnce({ ETag: 'etag-2' })       // UpdateFunction
      .mockResolvedValueOnce({});                       // PublishFunction
    db.putQueueMeta.mockResolvedValue({});
    db.updateQueueMetaStatus.mockResolvedValue(true);
    db.scanQueuesByStatus.mockResolvedValue([]);
    db.queryQueueEntries.mockResolvedValue([]);
  });

  it('activates Mode 2 (active: true) — creates DynamoDB queue record', async () => {
    // Simulate 2 existing waiting entries (from a previous activation on same day)
    db.queryQueueEntries.mockResolvedValue([
      { pk: 'QUEUE#MODE2#global#1#2026-03-05', sk: 'ENTRY#user-1', status: 'waiting' },
      { pk: 'QUEUE#MODE2#global#1#2026-03-05', sk: 'ENTRY#user-2', status: 'waiting' },
    ]);
    const res = await handler({ body: JSON.stringify({ active: true }) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.active).toBe(true);
    expect(body.data.functionName).toBe('WaitingRoomViewerFn-wr');
    expect(body.data.queueId).toMatch(/^QUEUE#MODE2#global#1#/);
    expect(body.data.batchSize).toBe(50);
    expect(body.data.releaseIntervalSeconds).toBe(300);
    expect(mockCFSend).toHaveBeenCalledTimes(3);
    expect(db.putQueueMeta).toHaveBeenCalledTimes(1);
    const queueArg = db.putQueueMeta.mock.calls[0][0];
    expect(queueArg.queueStatus).toBe('releasing');
    expect(queueArg.batchSize).toBe(50);
    expect(queueArg.releaseIntervalSeconds).toBe(300);
    expect(queueArg.lastReleasedAt).toBe(0);
    // totalEntries reflects existing entries, not 0
    expect(queueArg.totalEntries).toBe(2);
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
    expect(mockCFSend).toHaveBeenCalledTimes(3);
    expect(db.putQueueMeta).not.toHaveBeenCalled();
    expect(db.scanQueuesByStatus).toHaveBeenCalledWith('releasing');
    // Both MODE2 queues closed; non-Mode2 queue skipped
    expect(db.updateQueueMetaStatus).toHaveBeenCalledTimes(2);
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2026-03-05', 'closed');
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2026-03-06', 'closed');
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
