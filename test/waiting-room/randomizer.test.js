'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getQueueMeta: jest.fn(),
  updateQueueMetaStatus: jest.fn(),
  queryQueueEntries: jest.fn(),
  batchWriteEntries: jest.fn(),
}));

const handlerModule = require('../../src/handlers/waiting-room/randomizer/handler');
const { handler } = handlerModule;
const applyIpSpread = handlerModule._applyIpSpread;
const db = require('../../src/handlers/waiting-room/utils/dynamodb');

const queueId = 'QUEUE#golden-ears#camping#standard-sites#2025-06-15';

function makeEntries(count) {
  return Array.from({ length: count }, (_, i) => ({
    pk: queueId,
    sk: `ENTRY#user-${i}`,
    cognitoSub: `user-${i}`,
    clientIp: `10.0.0.${i % 10}`,
    status: 'waiting',
    facilityKey: 'golden-ears#camping#standard-sites',
    dateKey: '2025-06-15',
  }));
}

describe('WaitingRoom RANDOMIZER handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.updateQueueMetaStatus.mockResolvedValue(true);
    db.batchWriteEntries.mockResolvedValue();
  });

  it('returns error if queueId is missing', async () => {
    const result = await handler({}, {});
    expect(result.status).toBe('error');
  });

  it('returns skipped if queue is not pre-open', async () => {
    db.updateQueueMetaStatus.mockResolvedValue(false);
    db.getQueueMeta.mockResolvedValue({ queueStatus: 'releasing' });
    const result = await handler({ queueId }, {});
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not-pre-open');
  });

  it('closes queue immediately if there are no waiting entries', async () => {
    db.queryQueueEntries.mockResolvedValue([]);
    const result = await handler({ queueId }, {});
    expect(result.status).toBe('closed');
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'closed', 'randomizing');
  });

  it('assigns randomOrder to all entries', async () => {
    const entries = makeEntries(10);
    db.queryQueueEntries.mockResolvedValue(entries);

    await handler({ queueId }, {});

    expect(db.batchWriteEntries).toHaveBeenCalledTimes(1);
    const writtenEntries = db.batchWriteEntries.mock.calls[0][0];
    expect(writtenEntries).toHaveLength(10);

    const orders = writtenEntries.map(e => e.randomOrder).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('transitions queue to releasing after successful randomization', async () => {
    const entries = makeEntries(5);
    db.queryQueueEntries.mockResolvedValue(entries);

    const result = await handler({ queueId }, {});

    expect(result.status).toBe('releasing');
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'releasing', 'randomizing');
  });

  it('returns the number of entries processed', async () => {
    const entries = makeEntries(7);
    db.queryQueueEntries.mockResolvedValue(entries);

    const result = await handler({ queueId }, {});
    expect(result.entriesProcessed).toBe(7);
  });

  it('does not produce duplicate randomOrder values', async () => {
    const entries = makeEntries(20);
    db.queryQueueEntries.mockResolvedValue(entries);

    await handler({ queueId }, {});
    const writtenEntries = db.batchWriteEntries.mock.calls[0][0];
    const orders = writtenEntries.map(e => e.randomOrder);
    const uniqueOrders = new Set(orders);
    expect(uniqueOrders.size).toBe(20);
  });

  // ─── Error handling / idempotency ─────────────────────────────────────────

  it('reverts to pre-open and throws if batchWriteEntries fails', async () => {
    const entries = makeEntries(5);
    db.queryQueueEntries.mockResolvedValue(entries);
    db.batchWriteEntries.mockRejectedValue(new Error('DynamoDB timeout'));

    await expect(handler({ queueId }, {})).rejects.toThrow('DynamoDB timeout');

    // Should have attempted revert
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'pre-open', 'randomizing');
    // Should NOT have attempted the releasing transition
    expect(db.updateQueueMetaStatus).not.toHaveBeenCalledWith(queueId, 'releasing', 'randomizing');
  });

  it('skips shuffle and write if randomOrder already assigned (idempotency)', async () => {
    // Simulate entries already written by a previous run
    const entries = makeEntries(5).map((e, i) => ({ ...e, randomOrder: i }));
    db.queryQueueEntries.mockResolvedValue(entries);

    const result = await handler({ queueId }, {});

    // Should not re-write entries
    expect(db.batchWriteEntries).not.toHaveBeenCalled();
    // Should still transition to releasing
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(queueId, 'releasing', 'randomizing');
    expect(result.status).toBe('releasing');
  });

  it('throws and logs context if step 5 transition to releasing fails', async () => {
    const { logger } = require('/opt/base');
    const entries = makeEntries(5);
    db.queryQueueEntries.mockResolvedValue(entries);
    // First call (randomizing) succeeds, second call (releasing) fails
    db.updateQueueMetaStatus
      .mockResolvedValueOnce(true)   // pre-open → randomizing
      .mockRejectedValueOnce(new Error('ConditionalCheckFailed')); // randomizing → releasing

    await expect(handler({ queueId }, {})).rejects.toThrow('ConditionalCheckFailed');

    // Should have logged a critical error mentioning manual recovery
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Manual recovery'),
      expect.any(Error)
    );
  });
});

// ─── applyIpSpread unit tests ─────────────────────────────────────────────────

function e(ip) { return { clientIp: ip }; }

describe('applyIpSpread', () => {
  const MIN = 5; // matches handler constant

  function violationsCount(arr) {
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      const ip = arr[i].clientIp;
      if (!ip || ip === 'unknown') continue;
      for (let j = Math.max(0, i - MIN); j < i; j++) {
        if (arr[j].clientIp === ip) { count++; break; }
      }
    }
    return count;
  }

  it('leaves an already-spread array unchanged', () => {
    const arr = ['a','b','c','d','e','a','b','c','d','e'].map(e);
    const before = arr.map(x => x.clientIp).join(',');
    applyIpSpread(arr);
    expect(arr.map(x => x.clientIp).join(',')).toBe(before);
  });

  it('resolves a simple two-entry same-IP violation', () => {
    // 'a' at pos 0 and 2 — spacing 2 < MIN=5, plenty of room to fix
    const arr = [e('a'), e('x'), e('a'), ...Array.from({ length: 17 }, (_, i) => e(`u${i}`))];
    applyIpSpread(arr);
    expect(violationsCount(arr)).toBe(0);
  });

  it('resolves multiple same-IP violations across the array', () => {
    // Each IP appears twice, deliberately packed close at the start
    // Array is long enough that spacing is always achievable
    const arr = [
      e('a'), e('a'), e('b'), e('b'), e('c'), e('c'),
      ...Array.from({ length: 24 }, (_, i) => e(`u${i}`)),
    ];
    applyIpSpread(arr);
    expect(violationsCount(arr)).toBe(0);
  });

  // fix 1 (i--) and fix 2 (candidate validation) interact: fix 2 validates the full
  // [i-MIN, i+MIN] window for the candidate, ensuring the placed element won't violate
  // at position i. fix 1 re-examines position i anyway as a safety net. Together they
  // guarantee the element placed at i is always valid before the loop advances.

  it('fix 2 — never places a candidate whose IP would cluster at the destination', () => {
    // 'a' violation at pos 4 (arr[0] and arr[4] are both 'a', spacing=4).
    // Naive first candidate beyond MIN: arr[9]='b', but 'b' also exists at pos 2
    // (within the window [0,9] around pos 4), so fix 2 must reject it.
    // Only 'z'-family entries at pos 10+ are valid candidates.
    // Run 50 times: without fix 2, ~10% of runs would pick 'b', leaving a b-violation.
    // With fix 2, every run must produce 0 violations.
    for (let run = 0; run < 50; run++) {
      const arr = [
        e('a'), e('x1'), e('b'), e('x2'), e('a'),  // pos 0-4: 'a' violation; 'b' at pos 2
        e('x3'), e('x4'), e('x5'), e('x6'), e('b'), // pos 5-9: 'b' at pos 9 (naive first candidate)
        ...Array.from({ length: 10 }, (_, i) => e(`z${i}`)), // pos 10-19: valid
      ];
      applyIpSpread(arr);
      expect(violationsCount(arr)).toBe(0);
    }
  });

  it('handles unknown/missing IPs without errors', () => {
    const arr = [e('unknown'), e(undefined), e('a'), e('b'), e('c'),
                 e('unknown'), e(undefined), e('a'), e('b'), e('c')];
    expect(() => applyIpSpread(arr)).not.toThrow();
  });

  it('does not loop infinitely when no valid candidates exist (all same IP)', () => {
    const arr = Array.from({ length: 20 }, () => e('same'));
    expect(() => applyIpSpread(arr)).not.toThrow();
    expect(arr.length).toBe(20);
  });

  it('swap budget prevents infinite loop on adversarial alternating input', () => {
    // Two IPs alternating every 2 — many violations, constrained candidates
    const arr = Array.from({ length: 30 }, (_, i) => e(i % 2 === 0 ? 'a' : 'b'));
    expect(() => applyIpSpread(arr)).not.toThrow();
    expect(arr.length).toBe(30);
  });
});
