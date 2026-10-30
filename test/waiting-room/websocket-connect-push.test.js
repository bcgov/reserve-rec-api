'use strict';

const mockWsSend = jest.fn();
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ...jest.requireActual('@aws-sdk/client-apigatewaymanagementapi'),
  ApiGatewayManagementApiClient: jest.fn(() => ({ send: mockWsSend })),
}));
jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getQueueEntry: jest.fn(),
  setConnectionId: jest.fn(),
  putConnectionRecord: jest.fn(),
}));

const db = require('../../src/handlers/waiting-room/utils/dynamodb');
const { handler } = require('../../src/handlers/waiting-room/websocket/connect');

const queueId = 'QUEUE#bcparks_7#dayuse#1#2026-07-01';
const connect = () => ({ requestContext: { connectionId: 'conn-new', authorizer: { userId: 'sub-1', queueId } } });
const commands = () => mockWsSend.mock.calls.map(([cmd]) => cmd.constructor.name);

describe('WebSocket $connect pushes to an admitted user', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://ws.example.com/api';
    mockWsSend.mockResolvedValue({});
  });
  afterEach(() => delete process.env.WEBSOCKET_MANAGEMENT_ENDPOINT);

  it('re-sends the admitted message on the new connection after storing it', async () => {
    db.getQueueEntry.mockResolvedValue({ status: 'admitted' });

    const res = await handler(connect());

    expect(res).toEqual({ statusCode: 200 });
    expect(db.setConnectionId).toHaveBeenCalledWith(queueId, 'sub-1', 'conn-new');
    expect(commands()).toEqual(['PostToConnectionCommand']);
    const { input } = mockWsSend.mock.calls[0][0];
    expect(input.ConnectionId).toBe('conn-new');
    expect(JSON.parse(Buffer.from(input.Data).toString())).toEqual({ type: 'admitted' });
  });

  it('drops the old connection before pushing to the new one', async () => {
    db.getQueueEntry.mockResolvedValue({ status: 'admitted', connectionId: 'conn-old' });
    await handler(connect());
    expect(commands()).toEqual(['DeleteConnectionCommand', 'PostToConnectionCommand']);
    expect(mockWsSend.mock.calls[0][0].input).toEqual({ ConnectionId: 'conn-old' });
  });

  it('still connects when the push fails', async () => {
    db.getQueueEntry.mockResolvedValue({ status: 'admitted' });
    mockWsSend.mockRejectedValueOnce(new Error('GoneException'));
    expect(await handler(connect())).toEqual({ statusCode: 200 });
  });

  it('does not push to a user still waiting, or without a management endpoint', async () => {
    db.getQueueEntry.mockResolvedValue({ status: 'waiting' });
    await handler(connect());
    delete process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
    db.getQueueEntry.mockResolvedValue({ status: 'admitted' });
    await handler(connect());
    expect(mockWsSend).not.toHaveBeenCalled();
  });

  it('returns 500 when the connection record cannot be written', async () => {
    db.getQueueEntry.mockResolvedValue({ status: 'waiting' });
    db.putConnectionRecord.mockRejectedValueOnce(new Error('throttled'));
    expect(await handler(connect())).toEqual({ statusCode: 500 });
    expect(db.setConnectionId).not.toHaveBeenCalled();
  });
});
