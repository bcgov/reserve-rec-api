'use strict';

const mockLambdaSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  ...jest.requireActual('@aws-sdk/client-lambda'),
  LambdaClient: jest.fn(() => ({ send: mockLambdaSend })),
}));
jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  scanExpiredEntries: jest.fn(),
  updateQueueEntryStatus: jest.fn(),
  incrementAbandonedCount: jest.fn(),
  decrementAdmittedCount: jest.fn(),
}));

const db = require('../../src/handlers/waiting-room/utils/dynamodb');
const { handler } = require('../../src/handlers/waiting-room/cleanup/handler');

const Q1 = 'QUEUE#bcparks_7#dayuse#1#2026-07-01';
const Q2 = 'QUEUE#bcparks_8#dayuse#1#2026-07-01';
const entry = (pk, userId) => ({ pk, userId });
const invokedQueues = () => mockLambdaSend.mock.calls.map(([cmd]) => JSON.parse(Buffer.from(cmd.input.Payload).toString()).queueId);

describe('WaitingRoom CLEANUP release trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RELEASE_LAMBDA_ARN = 'arn:aws:lambda:ca-central-1:123:function:release';
    db.updateQueueEntryStatus.mockResolvedValue(true);
    mockLambdaSend.mockResolvedValue({});
  });
  afterEach(() => delete process.env.RELEASE_LAMBDA_ARN);

  it('fires one async release per queue that freed a slot', async () => {
    db.scanExpiredEntries
      .mockResolvedValueOnce([entry(Q1, 'a'), entry(Q1, 'b')])
      .mockResolvedValueOnce([entry(Q2, 'c')])
      .mockResolvedValueOnce([]);

    await handler({}, {});

    expect(invokedQueues()).toEqual([Q1, Q2]);
    const input = mockLambdaSend.mock.calls[0][0].input;
    expect(input).toMatchObject({ FunctionName: 'arn:aws:lambda:ca-central-1:123:function:release', InvocationType: 'Event' });
  });

  it('does not release for recovered admitting entries or lost races', async () => {
    db.scanExpiredEntries
      .mockResolvedValueOnce([entry(Q1, 'a')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([entry(Q2, 'z')]);
    db.updateQueueEntryStatus.mockResolvedValueOnce(false).mockResolvedValue(true);

    const result = await handler({}, {});

    expect(result).toEqual({ expiredCount: 0, abandonedCount: 0, recoveredCount: 1 });
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('keeps going when one release invoke fails', async () => {
    db.scanExpiredEntries
      .mockResolvedValueOnce([entry(Q1, 'a'), entry(Q2, 'b')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockLambdaSend.mockRejectedValueOnce(new Error('throttled'));

    const result = await handler({}, {});

    expect(result.expiredCount).toBe(2);
    expect(invokedQueues()).toEqual([Q1, Q2]);
  });

  it('rethrows a scan failure so the scheduled run is marked failed', async () => {
    db.scanExpiredEntries.mockRejectedValue(new Error('scan failed'));
    await expect(handler({}, {})).rejects.toThrow('scan failed');
  });
});
