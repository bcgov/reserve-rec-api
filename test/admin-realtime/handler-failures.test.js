'use strict';

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (...a) => mockDdbSend(...a) })),
}));
jest.mock('../../src/handlers/admin-realtime/topics', () => ({
  TOPICS: { customers: { minTier: 'staff' } },
  canSubscribe: () => true,
}));

const disconnect = require('../../src/handlers/admin-realtime/disconnect');
const subscribe = require('../../src/handlers/admin-realtime/subscribe');
const unsubscribe = require('../../src/handlers/admin-realtime/unsubscribe');

const message = (body) => ({ requestContext: { connectionId: 'conn-1' }, body: JSON.stringify(body) });

describe('admin realtime routes when DynamoDB fails', () => {
  beforeEach(() => {
    process.env.ADMIN_REALTIME_TABLE_NAME = 'AdminRealtimeTable-test';
    mockDdbSend.mockReset().mockRejectedValue(new Error('throttled'));
  });

  it('$disconnect without a connectionId is a no-op 200', async () => {
    await expect(disconnect.handler({ requestContext: {} })).resolves.toEqual({ statusCode: 200 });
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  it('$disconnect returns 500 when the rows cannot be removed', async () => {
    await expect(disconnect.handler({ requestContext: { connectionId: 'conn-1' } })).resolves.toEqual({ statusCode: 500 });
  });

  it('subscribe returns 500 when the META read fails', async () => {
    await expect(subscribe.handler(message({ action: 'subscribe', topic: 'customers' }))).resolves.toEqual({ statusCode: 500 });
  });

  it('unsubscribe returns 500 when the TOPIC delete fails', async () => {
    await expect(unsubscribe.handler(message({ action: 'unsubscribe', topic: 'customers' }))).resolves.toEqual({ statusCode: 500 });
  });
});
