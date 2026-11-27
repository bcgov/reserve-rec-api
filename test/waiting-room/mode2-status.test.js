'use strict';

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getActiveMode2Meta: jest.fn(),
  scanQueuesByStatus: jest.fn(),
}));

const { getActiveMode2Meta, scanQueuesByStatus } = require('../../src/handlers/waiting-room/utils/dynamodb');
const { handler } = require('../../src/handlers/waiting-room/GET/mode2-status');

const data = (res) => JSON.parse(res.body).data;

describe('WaitingRoom GET mode2-status', () => {
  beforeEach(() => jest.resetAllMocks());

  it('answers preflight without a read', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res).toMatchObject({ statusCode: 200, body: '' });
    expect(getActiveMode2Meta).not.toHaveBeenCalled();
  });

  it('is active when the Mode 2 pointer names an open queue, without scanning the table', async () => {
    getActiveMode2Meta.mockResolvedValue({ pk: 'QUEUE#MODE2#global#1#2026-07-01', queueStatus: 'releasing' });
    expect(data(await handler({ httpMethod: 'GET' }))).toEqual({ active: true });
    expect(scanQueuesByStatus).not.toHaveBeenCalled();
  });

  it('is inactive when Mode 2 is off', async () => {
    getActiveMode2Meta.mockResolvedValue(null);
    expect(data(await handler({ httpMethod: 'GET' }))).toEqual({ active: false });
  });

  it('returns 500 when the read fails', async () => {
    getActiveMode2Meta.mockRejectedValue(new Error('throttled'));
    expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(500);
  });
});
