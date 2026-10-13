'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// Commands become plain { type, input } records so tests can assert on them.
const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => {
  const command = (type) => function (input) { return { type, input }; };
  return {
    DynamoDBClient: function () { return { send: (...args) => mockDdbSend(...args) }; },
    PutItemCommand: command('Put'),
    GetItemCommand: command('Get'),
    DeleteItemCommand: command('Delete'),
  };
});

const mockCanSubscribe = jest.fn();
jest.mock('../../src/handlers/admin-realtime/topics', () => ({
  TOPICS: { customers: { minTier: 'staff', filters: [], resolve: jest.fn(), audience: jest.fn() } },
  canSubscribe: (...args) => mockCanSubscribe(...args),
}));

const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { logger } = require('/opt/base');
const connect = require('../../src/handlers/admin-realtime/connect');
const disconnect = require('../../src/handlers/admin-realtime/disconnect');
const subscribe = require('../../src/handlers/admin-realtime/subscribe');
const unsubscribe = require('../../src/handlers/admin-realtime/unsubscribe');
const ping = require('../../src/handlers/admin-realtime/ping');
const defaultRoute = require('../../src/handlers/admin-realtime/default');

const TABLE = 'AdminRealtimeTable-test';
const NOW = 1_760_000_000_000;

const requestContext = (extra = {}) => ({
  connectionId: 'conn-1',
  ...extra,
});
const message = (body) => ({ requestContext: requestContext(), body: JSON.stringify(body) });
const calls = (type) => mockDdbSend.mock.calls.map(([c]) => c).filter(c => c.type === type);
const TTL = NOW / 1000 + 3 * 60 * 60;
// Control replies are the route response body.
const body = (res) => {
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_REALTIME_TABLE_NAME = TABLE;
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockDdbSend.mockResolvedValue({});
});

afterEach(() => jest.restoreAllMocks());

describe('$connect', () => {
  const context = {
    userId: 'sub-1',
    permissions: '{"superadmin":"superadmin"}',
    isSuperAdmin: 'true',
    exp: '1760003600',
  };
  const connectEvent = (authorizer) => ({ requestContext: requestContext({ authorizer }) });

  it('writes META with permissions, exp and a 3 h ttl, and nothing else', async () => {
    const res = await connect.handler(connectEvent(context));

    expect(res.statusCode).toBe(200);
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    const [put] = calls('Put');
    expect(put.input.TableName).toBe(TABLE);
    expect(unmarshall(put.input.Item)).toEqual({
      pk: 'CONN#conn-1',
      sk: 'META',
      userId: 'sub-1',
      permissions: { superadmin: 'superadmin' },
      exp: 1760003600,
      connectedAt: NOW,
      ttl: TTL,
    });
    expect(logger.info).toHaveBeenCalledWith('event=realtime_connected', expect.objectContaining({ connectionId: 'conn-1' }));
  });

  it('returns 500 when the META write fails', async () => {
    mockDdbSend.mockRejectedValue(new Error('throttled'));
    const res = await connect.handler(connectEvent(context));
    expect(res.statusCode).toBe(500);
    expect(logger.info).not.toHaveBeenCalledWith('event=realtime_connected', expect.anything());
  });

  it.each([
    ['no authorizer context', undefined],
    ['no exp', { ...context, exp: undefined }],
  ])('rejects a connection with %s', async (_, authorizer) => {
    const res = await connect.handler(connectEvent(authorizer));
    expect(res.statusCode).toBe(400);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });
});

describe('$disconnect', () => {
  it('deletes the META row and the topic rows unconditionally', async () => {
    mockDdbSend.mockImplementation(async (c) => (
      c.input.ReturnValues === 'ALL_OLD'
        ? { Attributes: marshall({ pk: 'CONN#conn-1', sk: 'META', userId: 'sub-1' }) }
        : {}
    ));
    const res = await disconnect.handler({ requestContext: requestContext() });

    expect(res.statusCode).toBe(200);
    expect(calls('Delete')).toHaveLength(mockDdbSend.mock.calls.length);
    const keys = calls('Delete').map(c => {
      expect(c.input.TableName).toBe(TABLE);
      expect(c.input.ConditionExpression).toBeUndefined();
      return unmarshall(c.input.Key);
    });
    expect(keys).toEqual(expect.arrayContaining([
      { pk: 'CONN#conn-1', sk: 'META' },
      { pk: 'TOPIC#customers', sk: 'CONN#conn-1' },
    ]));
    expect(keys).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith('event=realtime_disconnected', { connectionId: 'conn-1', userId: 'sub-1' });
  });

  it('succeeds when META was already gone', async () => {
    const res = await disconnect.handler({ requestContext: requestContext() });
    expect(res.statusCode).toBe(200);
    expect(logger.info).toHaveBeenCalledWith('event=realtime_disconnected', { connectionId: 'conn-1', userId: undefined });
  });
});

describe('subscribe', () => {
  const meta = { pk: 'CONN#conn-1', sk: 'META', userId: 'sub-1', permissions: { bcparks_7: 'staff' }, exp: NOW / 1000 + 60 };
  const withMeta = (item) => mockDdbSend.mockImplementation(async (c) => (
    c.type === 'Get' ? { Item: item && marshall(item) } : {}
  ));

  it('writes the TOPIC row and replies subscribed when allowed', async () => {
    withMeta(meta);
    mockCanSubscribe.mockReturnValue(true);

    const res = await subscribe.handler(message({ action: 'subscribe', topic: 'customers' }));

    expect(unmarshall(calls('Get')[0].input.Key)).toEqual({ pk: 'CONN#conn-1', sk: 'META' });
    expect(mockCanSubscribe).toHaveBeenCalledWith('customers', { bcparks_7: 'staff' });
    expect(unmarshall(calls('Put')[0].input.Item)).toEqual({
      pk: 'TOPIC#customers',
      sk: 'CONN#conn-1',
      connectionId: 'conn-1',
      userId: 'sub-1',
      ttl: NOW / 1000 + 3 * 60 * 60,
    });
    expect(body(res)).toEqual({ type: 'subscribed', topic: 'customers' });
  });

  it('replies forbidden and writes nothing when not allowed', async () => {
    withMeta(meta);
    mockCanSubscribe.mockReturnValue(false);

    const res = await subscribe.handler(message({ action: 'subscribe', topic: 'customers' }));

    expect(calls('Put')).toHaveLength(0);
    expect(body(res)).toEqual({ type: 'error', code: 'forbidden' });
    expect(logger.info).toHaveBeenCalledWith('event=realtime_subscribe_forbidden', expect.objectContaining({ topic: 'customers' }));
  });

  it('replies forbidden when the connection has no META row', async () => {
    withMeta(null);
    const res = await subscribe.handler(message({ action: 'subscribe', topic: 'customers' }));
    expect(calls('Put')).toHaveLength(0);
    expect(mockCanSubscribe).not.toHaveBeenCalled();
    expect(body(res)).toEqual({ type: 'error', code: 'forbidden' });
  });

  it.each([
    ['at', NOW / 1000],
    ['past', NOW / 1000 - 1],
    ['missing', undefined],
  ])('replies forbidden and writes nothing when the token expiry is %s', async (_label, exp) => {
    const { exp: _omit, ...rest } = meta;
    withMeta(exp === undefined ? rest : { ...rest, exp });
    mockCanSubscribe.mockReturnValue(true);
    const res = await subscribe.handler(message({ action: 'subscribe', topic: 'customers' }));
    expect(calls('Put')).toHaveLength(0);
    expect(body(res)).toEqual({ type: 'error', code: 'forbidden' });
    expect(logger.info).toHaveBeenCalledWith('event=realtime_subscribe_forbidden', expect.objectContaining({ topic: 'customers' }));
  });

  it('replies unknown_topic for a topic not in the registry', async () => {
    const res = await subscribe.handler(message({ action: 'subscribe', topic: 'bookings' }));
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(body(res)).toEqual({ type: 'error', code: 'unknown_topic' });
  });

  it('does not treat inherited object keys as topics', async () => {
    const res = await subscribe.handler(message({ action: 'subscribe', topic: 'constructor' }));
    expect(body(res)).toEqual({ type: 'error', code: 'unknown_topic' });
  });

  it('replies bad_request for a missing topic or unparseable body', async () => {
    const results = [
      await subscribe.handler(message({ action: 'subscribe' })),
      await subscribe.handler({ requestContext: requestContext(), body: '{not json' }),
    ];
    expect(results.map(body)).toEqual([
      { type: 'error', code: 'bad_request' },
      { type: 'error', code: 'bad_request' },
    ]);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });
});

describe('unsubscribe', () => {
  it('deletes the TOPIC row and replies unsubscribed', async () => {
    const res = await unsubscribe.handler(message({ action: 'unsubscribe', topic: 'customers' }));
    expect(unmarshall(calls('Delete')[0].input.Key)).toEqual({ pk: 'TOPIC#customers', sk: 'CONN#conn-1' });
    expect(body(res)).toEqual({ type: 'unsubscribed', topic: 'customers' });
  });

  it('replies unknown_topic without touching the table', async () => {
    const res = await unsubscribe.handler(message({ action: 'unsubscribe', topic: 'nope' }));
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(body(res)).toEqual({ type: 'error', code: 'unknown_topic' });
  });
});

describe('ping and $default', () => {
  it('ping replies pong', async () => {
    expect(body(await ping.handler(message({ action: 'ping' })))).toEqual({ type: 'pong' });
  });

  it('$default replies bad_request', async () => {
    const res = await defaultRoute.handler(message({ action: 'what' }));
    expect(body(res)).toEqual({ type: 'error', code: 'bad_request' });
  });
});
