const mockSend = jest.fn();
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn(() => ({ send: mockSend })),
  PostToConnectionCommand: jest.fn((input) => ({ post: input })),
  DeleteConnectionCommand: jest.fn((input) => ({ close: input })),
}));

jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// A directly published topic: no source, no filters.
jest.mock('../../src/handlers/admin-realtime/topics', () => ({
  TOPICS: {
    widgets: { source: null, minTier: 'staff', audience: (event, permissions) => permissions.superadmin === 'superadmin' },
  },
}));

jest.mock('../../src/handlers/admin-realtime/store', () => ({
  ...jest.requireActual('../../src/handlers/admin-realtime/store'),
  removeConnection: jest.fn(async () => null),
}));

const mockRows = new Map();
jest.mock('/opt/dynamodb', () => ({
  runQuery: jest.fn(async (q) => ({
    items: [...mockRows.values()].filter((r) => r.pk === q.ExpressionAttributeValues[':pk'].S),
  })),
  batchGetData: jest.fn(async (keys) => keys.map((k) => mockRows.get(`${k.pk}|${k.sk}`)).filter(Boolean)),
}));

process.env.ADMIN_REALTIME_TABLE_NAME = 'AdminRealtimeTable';
process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://abc.execute-api.ca-central-1.amazonaws.com/ws';

const dynamodb = require('/opt/dynamodb');
const { logger } = require('/opt/base');
const { removeConnection } = require('../../src/handlers/admin-realtime/store');
const { publish } = require('../../src/handlers/admin-realtime/publish');

const future = () => Math.floor(Date.now() / 1000) + 3600;
function connect(id, permissions, exp = future()) {
  mockRows.set(`CONN#${id}|META`, { pk: `CONN#${id}`, sk: 'META', userId: `u-${id}`, permissions, exp });
  mockRows.set(`TOPIC#widgets|CONN#${id}`, { pk: 'TOPIC#widgets', sk: `CONN#${id}`, connectionId: id });
}
const gone = () => Object.assign(new Error('gone'), { name: 'GoneException', $metadata: { httpStatusCode: 410 } });
const posts = () => mockSend.mock.calls.map(([cmd]) => cmd.post).filter(Boolean);

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.clear();
  mockSend.mockResolvedValue({});
});

describe('publish', () => {
  it('returns zero counts and sends nothing without subscribers', async () => {
    await expect(publish('widgets', { type: 'changed', id: 'w1' })).resolves.toEqual({ sent: 0, failed: 0, gone: 0, expired: 0 });
    expect(dynamodb.batchGetData).not.toHaveBeenCalled();
  });

  it('sends a changed event without data to the audience and counts each outcome', async () => {
    connect('ok', { superadmin: 'superadmin' });
    connect('gone', { superadmin: 'superadmin' });
    connect('slow', { superadmin: 'superadmin' });
    connect('old', { superadmin: 'superadmin' }, 1);
    connect('staff', { bcparks_1: 'staff' });
    mockSend.mockImplementation(async (cmd) => {
      if (cmd.post?.ConnectionId === 'gone') throw gone();
      if (cmd.post?.ConnectionId === 'slow') throw Object.assign(new Error('x'), { name: 'LimitExceededException' });
      return {};
    });

    const counts = await publish('widgets', { type: 'changed', id: 'w1', at: 1760000000000 });

    expect(counts).toEqual({ sent: 1, failed: 1, gone: 1, expired: 1 });
    expect(posts().map((p) => p.ConnectionId).sort()).toEqual(['gone', 'ok', 'slow']);
    expect(JSON.parse(posts()[0].Data)).toEqual({ v: 1, topic: 'widgets', type: 'changed', id: 'w1', at: 1760000000000 });
    expect(removeConnection.mock.calls.map(([id]) => id).sort()).toEqual(['gone', 'old']);
    expect(logger.warn).toHaveBeenCalledWith('event=realtime_send_failed', expect.objectContaining({ connectionId: 'slow' }));
  });

  it('includes collectionId and data when given', async () => {
    connect('ok', { superadmin: 'superadmin' });
    await publish('widgets', { type: 'created', id: 'w1', collectionId: 'bcparks_1', data: { name: 'x' } });
    expect(JSON.parse(posts()[0].Data)).toMatchObject({ collectionId: 'bcparks_1', data: { name: 'x' }, at: expect.any(Number) });
  });

  it('throws when the subscription rows cannot be read', async () => {
    dynamodb.runQuery.mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    await expect(publish('widgets', { type: 'changed', id: 'w1' })).rejects.toThrow('throttled');
  });

  it('throws when META reads leave unprocessed keys', async () => {
    connect('ok', { superadmin: 'superadmin' });
    dynamodb.batchGetData.mockResolvedValueOnce(Object.assign([], { unprocessedKeys: [{}] }));
    await expect(publish('widgets', { type: 'changed', id: 'w1' })).rejects.toThrow('unprocessed');
  });

  it('throws for a topic missing from TOPICS', async () => {
    await expect(publish('nope', { type: 'changed', id: 'w1' })).rejects.toThrow('Unknown realtime topic');
    await expect(publish('constructor', { type: 'changed', id: 'w1' })).rejects.toThrow('Unknown realtime topic');
  });
});
