'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  scanQueuesByStatus: jest.fn(),
  updateQueueMetaStatus: jest.fn(),
  getActiveMode2QueueId: jest.fn(),
  restoreActiveMode2QueueId: jest.fn(),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  InvokeCommand: jest.fn(),
}));

const { handler } = require('../../src/handlers/waiting-room/queue-monitor/handler');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');

describe('WaitingRoom QUEUE MONITOR handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.RANDOMIZER_LAMBDA_ARN = 'arn:aws:lambda:ca-central-1:123:function:Randomizer';
    process.env.RELEASE_LAMBDA_ARN = 'arn:aws:lambda:ca-central-1:123:function:Release';
    process.env.STALE_RANDOMIZING_TIMEOUT_MINUTES = '5';

    db.scanQueuesByStatus.mockResolvedValue([]);
    db.updateQueueMetaStatus.mockResolvedValue(true);
    db.getActiveMode2QueueId.mockResolvedValue(null);
    db.restoreActiveMode2QueueId.mockResolvedValue(true);

    // Re-setup Lambda client mock after resetAllMocks
    const { LambdaClient } = require('@aws-sdk/client-lambda');
    LambdaClient.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    }));
  });

  it('returns zero counts when no queues need attention', async () => {
    const result = await handler({}, {});
    expect(result.randomizedCount).toBe(0);
    expect(result.staleResetCount).toBe(0);
    expect(result.releaseInvokedCount).toBe(0);
  });

  it('triggers randomizer for overdue pre-open queues', async () => {
    const overdueQueue = {
      pk: 'QUEUE#golden-ears#camping#sites#2025-06-15',
      openingTime: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      queueStatus: 'pre-open',
    };
    db.scanQueuesByStatus
      .mockResolvedValueOnce([overdueQueue]) // pre-open
      .mockResolvedValueOnce([])             // randomizing
      .mockResolvedValueOnce([]);            // releasing

    const result = await handler({}, {});
    expect(result.randomizedCount).toBe(1);
  });

  it('does not trigger randomizer for queues not yet at opening time', async () => {
    const futureQueue = {
      pk: 'QUEUE#golden-ears#camping#sites#2025-06-15',
      openingTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour in future
      queueStatus: 'pre-open',
    };
    db.scanQueuesByStatus
      .mockResolvedValueOnce([futureQueue])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await handler({}, {});
    expect(result.randomizedCount).toBe(0);
  });

  it('resets stale randomizing queues to pre-open', async () => {
    const staleQueue = {
      pk: 'QUEUE#golden-ears#camping#sites#2025-06-15',
      queueStatus: 'randomizing',
      updatedAt: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago (> 5min threshold)
    };
    db.scanQueuesByStatus
      .mockResolvedValueOnce([])           // pre-open
      .mockResolvedValueOnce([staleQueue]) // randomizing
      .mockResolvedValueOnce([]);          // releasing

    const result = await handler({}, {});
    expect(result.staleResetCount).toBe(1);
    expect(db.updateQueueMetaStatus).toHaveBeenCalledWith(
      staleQueue.pk, 'pre-open', 'randomizing'
    );
  });

  it('does not reset randomizing queues within the timeout window', async () => {
    const freshQueue = {
      pk: 'QUEUE#x',
      queueStatus: 'randomizing',
      updatedAt: Math.floor(Date.now() / 1000) - 60, // 1 minute ago (< 5min threshold)
    };
    db.scanQueuesByStatus
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([freshQueue])
      .mockResolvedValueOnce([]);

    const result = await handler({}, {});
    expect(result.staleResetCount).toBe(0);
  });

  it('invokes release lambda for each releasing queue', async () => {
    const releasingQueues = [
      { pk: 'QUEUE#q1', queueStatus: 'releasing' },
      { pk: 'QUEUE#q2', queueStatus: 'releasing' },
    ];
    db.scanQueuesByStatus
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(releasingQueues);

    const result = await handler({}, {});
    expect(result.releaseInvokedCount).toBe(2);
  });

  describe('Mode 2 pointer self-heal', () => {
    const releasing = (...queues) => db.scanQueuesByStatus
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(queues);

    it('restores a missing pointer to the newest releasing Mode 2 queue, and still releases', async () => {
      releasing(
        { pk: 'QUEUE#MODE2#global#1#2026-07-01', queueStatus: 'releasing' },
        { pk: 'QUEUE#MODE2#global#1#2026-07-02', queueStatus: 'releasing' },
        { pk: 'QUEUE#bcparks_7#dayuse#1#2026-07-03', queueStatus: 'releasing' },
      );
      const result = await handler({}, {});
      expect(db.restoreActiveMode2QueueId).toHaveBeenCalledWith('QUEUE#MODE2#global#1#2026-07-02');
      expect(result.mode2PointerRestored).toBe('QUEUE#MODE2#global#1#2026-07-02');
      expect(result.releaseInvokedCount).toBe(3);
    });

    it('leaves an existing pointer alone', async () => {
      db.getActiveMode2QueueId.mockResolvedValue('QUEUE#MODE2#global#1#2026-07-01');
      releasing({ pk: 'QUEUE#MODE2#global#1#2026-07-02', queueStatus: 'releasing' });
      const result = await handler({}, {});
      expect(db.restoreActiveMode2QueueId).not.toHaveBeenCalled();
      expect(result.mode2PointerRestored).toBeNull();
    });

    it('does not read the pointer when no Mode 2 queue is releasing', async () => {
      releasing({ pk: 'QUEUE#bcparks_7#dayuse#1#2026-07-03', queueStatus: 'releasing' });
      await handler({}, {});
      expect(db.getActiveMode2QueueId).not.toHaveBeenCalled();
    });

    it('still releases when restoring the pointer fails', async () => {
      db.restoreActiveMode2QueueId.mockRejectedValue(new Error('throttled'));
      releasing({ pk: 'QUEUE#MODE2#global#1#2026-07-02', queueStatus: 'releasing' });
      const result = await handler({}, {});
      expect(result.releaseInvokedCount).toBe(1);
    });
  });
});
