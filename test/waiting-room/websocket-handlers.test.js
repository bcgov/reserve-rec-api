'use strict';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
  getQueueEntry: jest.fn(),
  setConnectionId: jest.fn(),
  putConnectionRecord: jest.fn(),
  getConnectionRecord: jest.fn(),
  deleteConnectionRecord: jest.fn(),
  setDisconnectedAt: jest.fn(),
}));

// ─── $connect tests ──────────────────────────────────────────────────────────

describe('WebSocket $connect handler', () => {
  let connectHandler;
  let db;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('/opt/base', () => ({
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
      getQueueEntry: jest.fn(),
      setConnectionId: jest.fn(),
      putConnectionRecord: jest.fn(),
      getConnectionRecord: jest.fn(),
      deleteConnectionRecord: jest.fn(),
      setDisconnectedAt: jest.fn(),
    }));

    db = require('../../src/handlers/waiting-room/utils/dynamodb');
    connectHandler = require('../../src/handlers/waiting-room/websocket/connect');
  });

  const makeConnectEvent = (overrides = {}) => ({
    requestContext: {
      connectionId: 'conn-abc123',
      authorizer: {
        cognitoSub: 'user-sub-456',
        queueId: 'QUEUE#golden-ears#camping#standard#2025-06-15',
      },
      ...overrides.requestContext,
    },
  });

  const waitingEntry = {
    pk: 'QUEUE#golden-ears#camping#standard#2025-06-15',
    sk: 'ENTRY#user-sub-456',
    cognitoSub: 'user-sub-456',
    status: 'waiting',
    connectionId: null,
  };

  it('returns 200 on successful connect', async () => {
    db.getQueueEntry.mockResolvedValue(waitingEntry);
    db.setConnectionId.mockResolvedValue();
    db.putConnectionRecord.mockResolvedValue();

    const result = await connectHandler.handler(makeConnectEvent());
    expect(result.statusCode).toBe(200);
    expect(db.setConnectionId).toHaveBeenCalledWith(
      'QUEUE#golden-ears#camping#standard#2025-06-15',
      'user-sub-456',
      'conn-abc123',
    );
    expect(db.putConnectionRecord).toHaveBeenCalledWith(
      'conn-abc123',
      'QUEUE#golden-ears#camping#standard#2025-06-15',
      'user-sub-456',
    );
  });

  it('returns 400 if connectionId is missing', async () => {
    const event = { requestContext: { authorizer: { cognitoSub: 'sub', queueId: 'QUEUE#x' } } };
    const result = await connectHandler.handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 if cognitoSub is missing from authorizer context', async () => {
    const event = { requestContext: { connectionId: 'conn-1', authorizer: { queueId: 'QUEUE#x' } } };
    const result = await connectHandler.handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 403 if no queue entry found', async () => {
    db.getQueueEntry.mockResolvedValue(null);
    const result = await connectHandler.handler(makeConnectEvent());
    expect(result.statusCode).toBe(403);
  });

  it('returns 403 if entry status is not active', async () => {
    db.getQueueEntry.mockResolvedValue({ ...waitingEntry, status: 'expired' });
    const result = await connectHandler.handler(makeConnectEvent());
    expect(result.statusCode).toBe(403);
  });

  it('allows reconnect for admitted entry', async () => {
    db.getQueueEntry.mockResolvedValue({ ...waitingEntry, status: 'admitted' });
    db.setConnectionId.mockResolvedValue();
    db.putConnectionRecord.mockResolvedValue();

    const result = await connectHandler.handler(makeConnectEvent());
    expect(result.statusCode).toBe(200);
  });

  it('attempts to disconnect previous connection when different connectionId exists', async () => {
    const mockDelete = jest.fn().mockResolvedValue({});
    jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
      ApiGatewayManagementApiClient: jest.fn(() => ({ send: mockDelete })),
      DeleteConnectionCommand: jest.fn(args => args),
    }));

    process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://example.execute-api.ca-central-1.amazonaws.com/prod';

    db.getQueueEntry.mockResolvedValue({
      ...waitingEntry,
      connectionId: 'old-conn-999',
    });
    db.setConnectionId.mockResolvedValue();
    db.putConnectionRecord.mockResolvedValue();

    // Re-require after env set
    delete require.cache[require.resolve('../../src/handlers/waiting-room/websocket/connect')];
    const freshConnect = require('../../src/handlers/waiting-room/websocket/connect');

    const result = await freshConnect.handler(makeConnectEvent());
    expect(result.statusCode).toBe(200);
    // Connection record and setConnectionId should still be called
    expect(db.setConnectionId).toHaveBeenCalled();
    expect(db.putConnectionRecord).toHaveBeenCalled();

    delete process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
  });
});

// ─── $disconnect tests ────────────────────────────────────────────────────────

describe('WebSocket $disconnect handler', () => {
  let disconnectHandler;
  let db;

  beforeEach(() => {
    jest.resetModules();

    jest.mock('/opt/base', () => ({
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    }));
    jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({
      getQueueEntry: jest.fn(),
      setConnectionId: jest.fn(),
      putConnectionRecord: jest.fn(),
      getConnectionRecord: jest.fn(),
      deleteConnectionRecord: jest.fn(),
      setDisconnectedAt: jest.fn(),
    }));

    db = require('../../src/handlers/waiting-room/utils/dynamodb');
    disconnectHandler = require('../../src/handlers/waiting-room/websocket/disconnect');
  });

  const makeDisconnectEvent = (connectionId = 'conn-abc123') => ({
    requestContext: { connectionId },
  });

  it('sets disconnectedAt and deletes connection record on disconnect', async () => {
    db.getConnectionRecord.mockResolvedValue({
      queueId: 'QUEUE#golden-ears#camping#standard#2025-06-15',
      cognitoSub: 'user-sub-456',
    });
    db.setDisconnectedAt.mockResolvedValue();
    db.deleteConnectionRecord.mockResolvedValue();

    const result = await disconnectHandler.handler(makeDisconnectEvent());
    expect(result.statusCode).toBe(200);
    expect(db.setDisconnectedAt).toHaveBeenCalledWith(
      'QUEUE#golden-ears#camping#standard#2025-06-15',
      'user-sub-456',
    );
    expect(db.deleteConnectionRecord).toHaveBeenCalledWith('conn-abc123');
  });

  it('returns 200 if no connectionId in event (graceful)', async () => {
    const result = await disconnectHandler.handler({ requestContext: {} });
    expect(result.statusCode).toBe(200);
    expect(db.setDisconnectedAt).not.toHaveBeenCalled();
  });

  it('returns 200 if no connection record found (already cleaned up)', async () => {
    db.getConnectionRecord.mockResolvedValue(null);
    const result = await disconnectHandler.handler(makeDisconnectEvent());
    expect(result.statusCode).toBe(200);
    expect(db.setDisconnectedAt).not.toHaveBeenCalled();
    expect(db.deleteConnectionRecord).not.toHaveBeenCalled();
  });
});

// ─── $default tests ───────────────────────────────────────────────────────────

describe('WebSocket $default handler', () => {
  let defaultHandler;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('/opt/base', () => ({
      logger: { info: jest.fn(), debug: jest.fn() },
    }));
    defaultHandler = require('../../src/handlers/waiting-room/websocket/default');
  });

  it('returns 200 for any message', async () => {
    const result = await defaultHandler.handler({ requestContext: { connectionId: 'c1' }, body: '{"action":"ping"}' });
    expect(result.statusCode).toBe(200);
  });
});
