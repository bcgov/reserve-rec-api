'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  scanExpiredEntries: jest.fn(),
  updateQueueEntryStatus: jest.fn(),
  incrementAbandonedCount: jest.fn(),
  decrementAdmittedCount: jest.fn(),
}));

const { handler } = require('../../src/handlers/waiting-room/cleanup/handler');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');

const queueId = 'QUEUE#golden-ears#camping#standard-sites#2025-06-15';

function makeEntry(cognitoSub, status) {
  return { pk: queueId, sk: `ENTRY#${cognitoSub}`, cognitoSub, status };
}

describe('WaitingRoom CLEANUP handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.scanExpiredEntries.mockResolvedValue([]);
    db.updateQueueEntryStatus.mockResolvedValue(true);
  });

  it('returns zero counts when no entries need cleanup', async () => {
    const result = await handler({}, {});
    expect(result.expiredCount).toBe(0);
    expect(result.abandonedCount).toBe(0);
    expect(result.recoveredCount).toBe(0);
  });

  it('expires admitted entries past admissionExpiry', async () => {
    const expiredEntries = [makeEntry('user-1', 'admitted'), makeEntry('user-2', 'admitted')];
    db.scanExpiredEntries
      .mockResolvedValueOnce(expiredEntries) // expired admitted
      .mockResolvedValueOnce([])             // disconnected
      .mockResolvedValueOnce([]);            // stuck admitting

    const result = await handler({}, {});
    expect(result.expiredCount).toBe(2);
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(queueId, 'user-1', 'expired', 'admitted');
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(queueId, 'user-2', 'expired', 'admitted');
  });

  it('abandons disconnected waiting entries past grace period', async () => {
    const disconnected = [makeEntry('user-3', 'waiting')];
    db.scanExpiredEntries
      .mockResolvedValueOnce([])             // expired admitted
      .mockResolvedValueOnce(disconnected)   // disconnected
      .mockResolvedValueOnce([]);            // stuck admitting

    const result = await handler({}, {});
    expect(result.abandonedCount).toBe(1);
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(
      queueId, 'user-3', 'abandoned', 'waiting', expect.objectContaining({ abandonedAt: expect.any(Number) })
    );
    expect(db.incrementAbandonedCount).toHaveBeenCalledWith(queueId, 1);
  });

  it('recovers entries stuck in admitting state', async () => {
    const stuck = [makeEntry('user-4', 'admitting')];
    db.scanExpiredEntries
      .mockResolvedValueOnce([])    // expired admitted
      .mockResolvedValueOnce([])    // disconnected
      .mockResolvedValueOnce(stuck); // stuck admitting

    const result = await handler({}, {});
    expect(result.recoveredCount).toBe(1);
    expect(db.updateQueueEntryStatus).toHaveBeenCalledWith(queueId, 'user-4', 'waiting', 'admitting');
  });

  it('handles multiple cleanup categories in one run', async () => {
    db.scanExpiredEntries
      .mockResolvedValueOnce([makeEntry('u1', 'admitted')])
      .mockResolvedValueOnce([makeEntry('u2', 'waiting')])
      .mockResolvedValueOnce([makeEntry('u3', 'admitting')]);

    const result = await handler({}, {});
    expect(result.expiredCount).toBe(1);
    expect(result.abandonedCount).toBe(1);
    expect(result.recoveredCount).toBe(1);
  });

  it('counts only successfully updated entries', async () => {
    db.scanExpiredEntries
      .mockResolvedValueOnce([makeEntry('user-5', 'admitted')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    db.updateQueueEntryStatus.mockResolvedValue(false); // conditional check failed

    const result = await handler({}, {});
    expect(result.expiredCount).toBe(0); // not counted — update returned false
  });
});
