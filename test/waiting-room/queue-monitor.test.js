'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  scanQueuesByStatus: jest.fn(),
  updateQueueMetaStatus: jest.fn(),
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
});
