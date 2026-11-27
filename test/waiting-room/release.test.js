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
  claimMode2Release: jest.fn(),
  setEntryRandomOrder: jest.fn(),
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
const { mockWebSocket } = require('./helpers/mockWebSocket');

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
    userId: `user-${i}`,
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
      userId: `user-${i}`,
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
    db.claimMode2Release.mockResolvedValue(true);
    db.setEntryRandomOrder.mockResolvedValue(true);

    const { generateToken } = require('../../src/handlers/waiting-room/utils/token');
    generateToken.mockReturnValue('test-payload.test-sig');
    const { getHmacSigningKey } = require('../../src/handlers/waiting-room/utils/secrets');
    getHmacSigningKey.mockResolvedValue('test-hmac-key');

    const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
    ApiGatewayManagementApiClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    }));
  });

  describe('release claim', () => {
    it('claims the interval from the lastReleasedAt it read before writing anything', async () => {
      db.getQueueMeta.mockResolvedValue({ ...mode2Meta, lastReleasedAt: now - 600 });
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

      await handler({ queueId: mode2QueueId });

      expect(db.claimMode2Release).toHaveBeenCalledWith(mode2QueueId, now - 600, expect.any(Number));
      expect(db.claimMode2Release.mock.invocationCallOrder[0])
        .toBeLessThan(db.setEntryRandomOrder.mock.invocationCallOrder[0]);
    });

    it.each([
      ['a scheduled', {}],
      ['a forced', { force: true }],
    ])('skips %s release that loses the claim to a concurrent one', async (_, extra) => {
      db.claimMode2Release.mockResolvedValue(false);
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

      const result = await handler({ queueId: mode2QueueId, ...extra });

      expect(result).toEqual({ status: 'skipped', reason: 'release-in-progress', queueId: mode2QueueId });
      expect(db.setEntryRandomOrder).not.toHaveBeenCalled();
      expect(db.setEntryAdmitting).not.toHaveBeenCalled();
    });

    it('does not claim an interval when nobody is waiting', async () => {
      await handler({ queueId: mode2QueueId });
      expect(db.claimMode2Release).not.toHaveBeenCalled();
    });
  });

  it('returns too-soon when interval has not elapsed', async () => {
    const recentMeta = { ...mode2Meta, lastReleasedAt: now - 60 }; // released 60s ago, interval=300s
    db.getQueueMeta.mockResolvedValue(recentMeta);

    const result = await handler({ queueId: mode2QueueId });
    expect(result.status).toBe('too-soon');
    expect(result.nextRelease).toBe(recentMeta.lastReleasedAt + 300);
    expect(db.queryQueueEntries).not.toHaveBeenCalled();
  });

  describe('firstReleaseAt gate', () => {
    const gatedMeta = offsetMs => ({ ...mode2Meta, firstReleaseAt: new Date(Date.now() + offsetMs).toISOString() });
    let ws;
    beforeEach(() => { ws = mockWebSocket(); });

    it('holds without touching entries or pushing before the first release time', async () => {
      db.getQueueMeta.mockResolvedValue(gatedMeta(60 * 1000));
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

      const result = await handler({ queueId: mode2QueueId });
      expect(result).toEqual({ status: 'waiting', reason: 'before-first-release', queueId: mode2QueueId });
      expect(db.queryQueueEntries).not.toHaveBeenCalled();
      expect(db.claimMode2Release).not.toHaveBeenCalled();
      expect(db.setEntryRandomOrder).not.toHaveBeenCalled();
      expect(db.setEntryAdmitting).not.toHaveBeenCalled();
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('releases normally once the first release time has passed', async () => {
      db.getQueueMeta.mockResolvedValue(gatedMeta(-60 * 1000));
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

      const result = await handler({ queueId: mode2QueueId });
      expect(result.status).toBe('released');
      expect(result.admitted).toBe(1);
    });

    it('is bypassed by force (admin manual release)', async () => {
      db.getQueueMeta.mockResolvedValue(gatedMeta(60 * 1000));
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

      const result = await handler({ queueId: mode2QueueId, force: true });
      expect(result.status).toBe('released');
      expect(result.admitted).toBe(1);
    });
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

  describe('ordering', () => {
    const withOrder = (i, randomOrder) => ({ ...makeMode2Entry(i), randomOrder });
    const admittedIds = () => db.setEntryAdmitting.mock.calls.map(c => c[1]);
    let random;

    // Math.random() === 0 shuffles [a,b,c] into [b,c,a].
    beforeEach(() => { random = jest.spyOn(Math, 'random').mockReturnValue(0); });
    afterEach(() => random.mockRestore());

    it('admits entries that already hold a randomOrder before fresh ones, regardless of joinedAt', async () => {
      // user-0 joined first but is fresh; user-5 and user-4 were ordered earlier.
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0), withOrder(5, 1), withOrder(4, 0)]);

      await handler({ queueId: mode2QueueId });
      expect(admittedIds()).toEqual(['user-4', 'user-5']);
    });

    it('numbers fresh entries after the current max and writes them with a conditional update', async () => {
      db.queryQueueEntries.mockResolvedValue([withOrder(9, 7), makeMode2Entry(0), makeMode2Entry(1), makeMode2Entry(2)]);

      await handler({ queueId: mode2QueueId });
      const calls = db.setEntryRandomOrder.mock.calls;
      expect(calls.every(c => c[0] === mode2QueueId)).toBe(true);
      expect(Object.fromEntries(calls.map(c => [c[1], c[2]])))
        .toEqual({ 'user-1': 8, 'user-2': 9, 'user-0': 10 });
    });

    it('assigns 0..n-1 from the shuffle on the first release', async () => {
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0), makeMode2Entry(1), makeMode2Entry(2)]);

      await handler({ queueId: mode2QueueId });
      const orders = Object.fromEntries(db.setEntryRandomOrder.mock.calls.map(c => [c[1], c[2]]));
      expect(orders).toEqual({ 'user-1': 0, 'user-2': 1, 'user-0': 2 });
      expect(admittedIds()).toEqual(['user-1', 'user-2']);
    });

    it('respects batchSize and still admits when an order write loses its race', async () => {
      const entries = [0, 1, 2, 3].map(makeMode2Entry);
      db.queryQueueEntries.mockResolvedValue(entries);
      db.setEntryRandomOrder.mockResolvedValue(false);

      const result = await handler({ queueId: mode2QueueId });
      expect(result.admitted).toBe(2); // batchSize=2
      expect(admittedIds()).toHaveLength(2);
    });

    it('retries a throttled order write once', async () => {
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);
      const throttled = Object.assign(new Error('slow down'), { name: 'ProvisionedThroughputExceededException' });
      db.setEntryRandomOrder.mockRejectedValueOnce(throttled).mockResolvedValueOnce(true);

      const result = await handler({ queueId: mode2QueueId });

      expect(db.setEntryRandomOrder).toHaveBeenCalledTimes(2);
      expect(result.admitted).toBe(1);
    });

    it('does not retry a write that failed for another reason', async () => {
      db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);
      db.setEntryRandomOrder.mockRejectedValue(new Error('validation'));

      await handler({ queueId: mode2QueueId });

      expect(db.setEntryRandomOrder).toHaveBeenCalledTimes(1);
    });

    it('does not rewrite entries that already hold a randomOrder', async () => {
      db.queryQueueEntries.mockResolvedValue([withOrder(0, 0), withOrder(1, 1)]);

      await handler({ queueId: mode2QueueId });
      expect(db.setEntryRandomOrder).not.toHaveBeenCalled();
    });
  });

  describe('position pushes', () => {
    const goneErr = { name: 'GoneException', $metadata: { httpStatusCode: 410 } };
    let ws;
    let random;

    // Math.random() === 0 shuffles users 0..4 into line order 1,2,3,4,0; batchSize=2 admits 1 and 2.
    beforeEach(() => {
      random = jest.spyOn(Math, 'random').mockReturnValue(0);
      ws = mockWebSocket();
    });
    afterEach(() => random.mockRestore());

    const messages = () => ws.messages();
    const positions = () => ws.ofType('position');

    it('numbers the users still waiting 1..n in line order with total n', async () => {
      db.queryQueueEntries.mockResolvedValue([0, 1, 2, 3, 4].map(makeMode2Entry));

      await handler({ queueId: mode2QueueId });
      expect(positions()).toEqual([
        ['conn-3', { type: 'position', position: 1, total: 3 }],
        ['conn-4', { type: 'position', position: 2, total: 3 }],
        ['conn-0', { type: 'position', position: 3, total: 3 }],
      ]);
    });

    it('sends admitted, not a position, to the admitted batch', async () => {
      db.queryQueueEntries.mockResolvedValue([0, 1, 2, 3, 4].map(makeMode2Entry));

      await handler({ queueId: mode2QueueId });
      const admitted = messages().filter(([, m]) => m.type === 'admitted');
      expect(admitted).toEqual([['conn-1', { type: 'admitted' }], ['conn-2', { type: 'admitted' }]]);
      expect(positions().map(([id]) => id)).toEqual(['conn-3', 'conn-4', 'conn-0']);
    });

    it('skips waiting entries without a connectionId but still counts them in the line', async () => {
      const entries = [0, 1, 2, 3, 4].map(makeMode2Entry);
      delete entries[4].connectionId;
      db.queryQueueEntries.mockResolvedValue(entries);

      await handler({ queueId: mode2QueueId });
      expect(positions()).toEqual([
        ['conn-3', { type: 'position', position: 1, total: 3 }],
        ['conn-0', { type: 'position', position: 3, total: 3 }],
      ]);
    });

    it('keeps pushing and releases normally when one connection is gone', async () => {
      ws.send.mockImplementation(async (cmd) => {
        if (cmd.input.ConnectionId === 'conn-4') throw goneErr;
        return {};
      });
      db.queryQueueEntries.mockResolvedValue([0, 1, 2, 3, 4].map(makeMode2Entry));

      const result = await handler({ queueId: mode2QueueId });
      expect(result.status).toBe('released');
      expect(result.admitted).toBe(2);
      expect(positions().map(([id]) => id)).toEqual(['conn-3', 'conn-4', 'conn-0']);
    });
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
    // No status revert: the entry stays admitted.
    expect(db.updateQueueEntryStatus).not.toHaveBeenCalled();
  });

  it('does NOT close queue when all entries admitted (Mode 2 stays open)', async () => {
    db.queryQueueEntries.mockResolvedValue([makeMode2Entry(0)]);

    const result = await handler({ queueId: mode2QueueId });
    expect(result.status).toBe('released');
    expect(db.updateQueueMetaStatus).not.toHaveBeenCalled();
  });
});
