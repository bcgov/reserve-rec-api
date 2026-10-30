'use strict';

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({ scanQueuesByStatus: jest.fn() }));

const { scanQueuesByStatus } = require('../../src/handlers/waiting-room/utils/dynamodb');
const { handler } = require('../../src/handlers/waiting-room/GET/mode2-status');

const data = (res) => JSON.parse(res.body).data;

describe('WaitingRoom GET mode2-status', () => {
  beforeEach(() => scanQueuesByStatus.mockReset());

  it('answers preflight without a scan', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res).toMatchObject({ statusCode: 200, body: '' });
    expect(scanQueuesByStatus).not.toHaveBeenCalled();
  });

  it('is active when a Mode 2 queue is releasing', async () => {
    scanQueuesByStatus.mockResolvedValue([{ pk: 'QUEUE#bcparks_7#dayuse#1#2026-07-01' }, { pk: 'QUEUE#MODE2#global#1#2026-07-01' }]);
    expect(data(await handler({ httpMethod: 'GET' }))).toEqual({ active: true });
    expect(scanQueuesByStatus).toHaveBeenCalledWith('releasing');
  });

  it('is inactive when only facility queues are releasing', async () => {
    scanQueuesByStatus.mockResolvedValue([{ pk: 'QUEUE#bcparks_7#dayuse#1#2026-07-01' }, {}]);
    expect(data(await handler({ httpMethod: 'GET' }))).toEqual({ active: false });
  });

  it('returns 500 when the scan fails', async () => {
    scanQueuesByStatus.mockRejectedValue(new Error('throttled'));
    expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(500);
  });
});
