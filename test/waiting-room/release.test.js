'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getQueueMeta: jest.fn(),
  updateQueueMetaStatus: jest.fn(),
  updateQueueMetaLastReleasedAt: jest.fn(),
  queryQueueEntries: jest.fn(),
  setEntryAdmitting: jest.fn(),
  setEntryAdmitted: jest.fn(),
  updateQueueEntryStatus: jest.fn(),
  incrementAdmittedCount: jest.fn(),
  decrementAdmittedCount: jest.fn(),
}));

jest.mock('../../src/handlers/waiting-room/utils/token', () => ({
  generateToken: jest.fn(() => 'test-payload.test-sig'),
}));

jest.mock('../../src/handlers/waiting-room/utils/secrets', () => ({
  getHmacSigningKey: jest.fn(() => Promise.resolve('test-hmac-key')),
}));

// Mock @aws-sdk/client-apigatewaymanagementapi for WebSocket push
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PostToConnectionCommand: jest.fn(),
}));

const { handler } = require('../../src/handlers/waiting-room/release/handler');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');

const queueId = 'QUEUE#golden-ears#camping#standard-sites#2025-06-15';
const now = Math.floor(Date.now() / 1000);

const releasingMeta = {
  pk: queueId,
  sk: 'META',
  queueStatus: 'releasing',
  admittedCount: 0,
};

function makeWaitingEntry(i) {
  return {
    pk: queueId,
    sk: `ENTRY#user-${i}`,
    cognitoSub: `user-${i}`,
    status: 'waiting',
    randomOrder: i,
    facilityKey: 'golden-ears#camping#standard-sites',
    dateKey: '2025-06-15',
    connectionId: `conn-${i}`,
  };
}

describe('WaitingRoom RELEASE handler', () => {
  beforeEach(() => {
    // resetAllMocks clears both call records AND the once-queue between tests
    jest.resetAllMocks();
    process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://ws.example.com';
    process.env.MAX_ACTIVE_SESSIONS = '100';
    process.env.RELEASE_BATCH_SIZE = '50';
    process.env.ADMISSION_TTL_MINUTES = '15';

    db.getQueueMeta.mockResolvedValue(releasingMeta);
    db.queryQueueEntries.mockResolvedValue([]);
    db.incrementAdmittedCount.mockResolvedValue(true);
    db.setEntryAdmitting.mockResolvedValue(true);
    db.setEntryAdmitted.mockResolvedValue(true);
    db.updateQueueEntryStatus.mockResolvedValue(true);
    db.updateQueueMetaStatus.mockResolvedValue(true);
    db.updateQueueMetaLastReleasedAt.mockResolvedValue({});

    const { generateToken } = require('../../src/handlers/waiting-room/utils/token');
    generateToken.mockReturnValue('test-payload.test-sig');
    const { getHmacSigningKey } = require('../../src/handlers/waiting-room/utils/secrets');
    getHmacSigningKey.mockResolvedValue('test-hmac-key');

    // Restore ApiGatewayManagementApiClient default mock (send succeeds)
    const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
    ApiGatewayManagementApiClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    }));
  });

  it('returns error if queueId is missing', async () => {
    const result = await handler({}, {});
    expect(result.status).toBe('error');
  });

  it('returns error if queue not found', async () => {
    db.getQueueMeta.mockResolvedValue(null);
    const result = await handler({ queueId }, {});
    expect(result.status).toBe('error');
  });

  it('returns skipped if queue is not in releasing state', async () => {
    db.getQueueMeta.mockResolvedValue({ ...releasingMeta, queueStatus: 'pre-open' });
    const result = await handler({ queueId }, {});
    expect(result.status).toBe('skipped');
  });

  it('returns ceiling-reached if maxActiveSessions is hit', async () => {
    // 100 admitted entries already active
    const activeEntries = Array.from({ length: 100 }, (_, i) => ({
      status: 'admitted',
      admissionExpiry: now + 900,
    }));
    db.queryQueueEntries
      .mockResolvedValueOnce(activeEntries) // first call: count active
      .mockResolvedValueOnce([makeWaitingEntry(0)]); // second call: waiting entries

    const result = await handler({ queueId }, {});
    expect(result.status).toBe('ceiling-reached');
  });

  it('closes queue when no waiting entries remain', async () => {
    db.queryQueueEntries
      .mockResolvedValueOnce([]) // active count = 0
      .mockResolvedValueOnce([]); // no waiting

    const result = await handler({ queueId }, {});
    expect(result.status).toBe('closed');
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'closed', 'releasing');
  });

  it('admits a batch of waiting entries', async () => {
    const entries = [makeWaitingEntry(0), makeWaitingEntry(1), makeWaitingEntry(2)];
    db.queryQueueEntries
      .mockResolvedValueOnce([]) // active = 0
      .mockResolvedValueOnce(entries); // waiting

    const result = await handler({ queueId }, {});
    expect(result.status).toBe('released');
    expect(result.admitted).toBe(3);
    expect(db.setEntryAdmitting).toHaveBeenCalledTimes(3);
    expect(db.setEntryAdmitted).toHaveBeenCalledTimes(3);
  });

  it('reverts entry to waiting if WebSocket push fails', async () => {
    const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
    const gonErr = { name: 'GoneException', $metadata: { httpStatusCode: 410 } };
    ApiGatewayManagementApiClient.mockImplementationOnce(() => ({
      send: jest.fn().mockRejectedValue(gonErr),
    }));

    const entries = [makeWaitingEntry(0)];
    db.queryQueueEntries
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(entries);

    const result = await handler({ queueId }, {});
    expect(result.reverted).toBe(1);
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(queueId, 'user-0', 'waiting', 'admitting');
  });

  it('skips release if optimistic locking fails', async () => {
    db.incrementAdmittedCount.mockResolvedValue(false);
    db.queryQueueEntries
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeWaitingEntry(0)]);

    const result = await handler({ queueId }, {});
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('ceiling-race');
  });
});

// ── MODE2 release path ────────────────────────────────────────────────────────

describe('WaitingRoom RELEASE handler — MODE2 path', () => {
  const mode2QueueId = 'QUEUE#MODE2#global#1#2026-03-04';

  const mode2Meta = {
    pk: mode2QueueId,
    sk: 'META',
    queueStatus: 'releasing',
    batchSize: 2,
    releaseIntervalSeconds: 300,
    lastReleasedAt: 0,
    facilityKey: 'MODE2#global#1',
    admittedCount: 0,
  };

  function makeMode2Entry(i) {
    return {
      pk: mode2QueueId,
      sk: `ENTRY#user-${i}`,
      cognitoSub: `user-${i}`,
      status: 'waiting',
      joinedAt: 1700000000 + i,
      connectionId: `conn-${i}`,
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://ws.example.com';
    process.env.ADMISSION_TTL_MINUTES = '15';

    db.getQueueMeta.mockResolvedValue(mode2Meta);
    db.queryQueueEntries.mockResolvedValue([]);
    db.setEntryAdmitting.mockResolvedValue(true);
    db.setEntryAdmitted.mockResolvedValue(true);
    db.updateQueueEntryStatus.mockResolvedValue(true);
    db.updateQueueMetaLastReleasedAt.mockResolvedValue({});

    const { generateToken } = require('../../src/handlers/waiting-room/utils/token');
    generateToken.mockReturnValue('test-payload.test-sig');
    const { getHmacSigningKey } = require('../../src/handlers/waiting-room/utils/secrets');
    getHmacSigningKey.mockResolvedValue('test-hmac-key');

    const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
    ApiGatewayManagementApiClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    }));
  });

  it('returns too-soon when interval has not elapsed', async () => {
    const recentMeta = { ...mode2Meta, lastReleasedAt: now - 60 }; // released 60s ago, interval=300s
    db.getQueueMeta.mockResolvedValue(recentMeta);

    const result = await handler({ queueId: mode2QueueId });
    expect(result.status).toBe('too-soon');
    expect(result.nextRelease).toBe(recentMeta.lastReleasedAt + 300);
    expect(db.queryQueueEntries).not.toHaveBeenCalled();
  });

  it('bypasses time gate when force=true (admin manual release)', async () => {
    const recentMeta = { ...mode2Meta, lastReleasedAt: now - 60 }; // would normally be too-soon
    db.getQueueMeta.mockResolvedValue(recentMeta);
    db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

    const result = await handler({ queueId: mode2QueueId, force: true });
    expect(result.status).toBe('released');
    expect(result.admitted).toBe(1);
  });

  it('returns empty when no waiting entries and interval elapsed', async () => {
    db.queryQueueEntries.mockResolvedValue([]);
    const result = await handler({ queueId: mode2QueueId });
    expect(result.status).toBe('empty');
  });

  it('admits FIFO batch of waiting entries', async () => {
    const entries = [makeMode2Entry(2), makeMode2Entry(0), makeMode2Entry(1)]; // unsorted
    db.queryQueueEntries.mockResolvedValue(entries);

    const result = await handler({ queueId: mode2QueueId });
    expect(result.status).toBe('released');
    expect(result.admitted).toBe(2); // batchSize=2
    // Check FIFO order: user-0 (joinedAt smallest) should be admitted first
    const firstAdmitCall = db.setEntryAdmitting.mock.calls[0];
    expect(firstAdmitCall[1]).toBe('user-0');
    const secondAdmitCall = db.setEntryAdmitting.mock.calls[1];
    expect(secondAdmitCall[1]).toBe('user-1');
  });

  it('does not check ceiling (no incrementAdmittedCount)', async () => {
    db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

    await handler({ queueId: mode2QueueId });
    expect(db.incrementAdmittedCount).not.toHaveBeenCalled();
  });

  it('updates lastReleasedAt after batch', async () => {
    db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

    await handler({ queueId: mode2QueueId });
    expect(db.updateQueueMetaLastReleasedAt).toHaveBeenCalledWith(
      mode2QueueId,
      expect.any(Number),
      1  // successCount = 1
    );
  });

  it('admits entry even when WebSocket push fails (user claims on next page load)', async () => {
    const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
    const gonErr = { name: 'GoneException', $metadata: { httpStatusCode: 410 } };
    ApiGatewayManagementApiClient.mockImplementationOnce(() => ({
      send: jest.fn().mockRejectedValue(gonErr),
    }));

    db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

    const result = await handler({ queueId: mode2QueueId });
    // Entry is admitted regardless — user picks it up on next page load via join → handleAdmission()
    expect(result.admitted).toBe(1);
    expect(db.setEntryAdmitted).toHaveBeenCalledWith(mode2QueueId, 'user-0');
    expect(db.updateQueueEntryStatus).not.toHaveBeenCalled();
  });

  it('does NOT close queue when all entries admitted (Mode 2 stays open)', async () => {
    db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

    const result = await handler({ queueId: mode2QueueId });
    expect(result.status).toBe('released');
    expect(db.updateQueueMetaStatus).not.toHaveBeenCalled();
  });
});
