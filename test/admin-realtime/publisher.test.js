const mockPost = jest.fn();
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn(() => ({ send: mockPost })),
  PostToConnectionCommand: jest.fn((input) => ({ post: input })),
  DeleteConnectionCommand: jest.fn((input) => ({ close: input })),
}));

jest.mock('/opt/base', () => ({
  ...jest.requireActual('/opt/base'),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockAdminRows = new Map();
const mockTx = { users: new Map(), bookings: [] };
const rowKey = (k) => `${k.pk}|${k.sk}`;

jest.mock('../../src/handlers/admin-realtime/store', () => ({
  ...jest.requireActual('../../src/handlers/admin-realtime/store'),
  removeConnection: jest.fn(async (id) => {
    mockAdminRows.delete(`CONN#${id}|META`);
    mockAdminRows.delete(`TOPIC#customers|CONN#${id}`);
  }),
}));

jest.mock('/opt/dynamodb', () => {
  const { unmarshall } = jest.requireActual('@aws-sdk/util-dynamodb');
  return {
    unmarshall,
    TRANSACTIONAL_DATA_TABLE_NAME: 'TxTable',
    USERID_INDEX_NAME: 'userId-index',
    USERID_PROPERTY_NAME: 'userId',
    getOne: jest.fn(async (pk, sk) => (pk === 'user' ? mockTx.users.get(sk) ?? null : null)),
    runQuery: jest.fn(async (q) => {
      if (q.TableName === 'AdminRealtimeTable') {
        const pk = q.ExpressionAttributeValues[':pk'].S;
        return { items: [...mockAdminRows.values()].filter((r) => r.pk === pk) };
      }
      const v = q.ExpressionAttributeValues;
      const completed = Number(v[':completed'].N);
      return {
        items: mockTx.bookings.filter((b) => b.userId === v[':userId'].S
          && b.collectionId === v[':collectionId'].S
          && (b.bookingCompletionTime < completed
            || (b.bookingCompletionTime === completed && b.bookingId < v[':bookingId'].S))),
      };
    }),
    batchGetData: jest.fn(async (keys) => keys.map((k) => mockAdminRows.get(rowKey(k))).filter(Boolean)),
  };
});

process.env.ADMIN_REALTIME_TABLE_NAME = 'AdminRealtimeTable';
process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://abc.execute-api.ca-central-1.amazonaws.com/ws';
process.env.REALTIME_SOURCES = JSON.stringify({ TxTable: 'transactional' });
const streamArn = (table) => `arn:aws:dynamodb:ca-central-1:123456789012:table/${table}/stream/2026-10-01T00:00:00.000`;

const { marshall } = require('@aws-sdk/util-dynamodb');
const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
const { logger } = require('/opt/base');
const dynamodb = require('/opt/dynamodb');
const { removeConnection } = require('../../src/handlers/admin-realtime/store');
const { handler } = require('../../src/handlers/admin-realtime/publisher');

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

function connect(connectionId, permissions, exp = inAnHour()) {
  mockAdminRows.set(`CONN#${connectionId}|META`, {
    pk: `CONN#${connectionId}`, sk: 'META', userId: `u-${connectionId}`, permissions, ...(exp != null && { exp }),
  });
  mockAdminRows.set(`TOPIC#customers|CONN#${connectionId}`, { pk: 'TOPIC#customers', sk: `CONN#${connectionId}`, connectionId });
}

const record = (eventName, newItem, oldItem, seq = '100') => ({
  eventName,
  eventID: `e-${seq}`,
  eventSourceARN: streamArn('TxTable'),
  dynamodb: {
    ApproximateCreationDateTime: 1760000000,
    Keys: marshall({ pk: newItem.pk, sk: newItem.sk }),
    NewImage: marshall(newItem),
    ...(oldItem && { OldImage: marshall(oldItem) }),
    SequenceNumber: seq,
  },
});

const user = {
  pk: 'user', sk: 'sub-1', schema: 'user', givenName: 'Ada', familyName: 'L', email: 'ada@example.com',
  mobilePhone: '+12505550100', createdAt: '2026-10-01T00:00:00.000-07:00', lastLogin: '2026-10-01T00:00:00.000-07:00',
};
const held = {
  pk: 'booking::bcparks_1::dayuse::1::1', sk: '2026-10-10::b1', schema: 'booking', bookingId: 'b1',
  userId: 'sub-1', collectionId: 'bcparks_1', status: 'in progress',
};
const completed = { ...held, status: 'confirmed', bookingCompletionTime: 1760000000500 };

const posts = () => mockPost.mock.calls.map(([cmd]) => cmd.post).filter(Boolean);
const closes = () => mockPost.mock.calls.map(([cmd]) => cmd.close?.ConnectionId).filter(Boolean).sort();
const sentTo = () => posts().map((p) => p.ConnectionId).sort();
const sentPayload = () => JSON.parse(posts()[0].Data);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';
  mockAdminRows.clear();
  mockTx.users = new Map([['sub-1', user]]);
  mockTx.bookings = [completed];
  mockPost.mockResolvedValue({});
  connect('super', { superadmin: 'superadmin' });
  connect('staff1', { bcparks_1: 'staff' });
  connect('limited1', { bcparks_1: 'limited' });
  connect('staff2', { bcparks_2: 'staff' });
});

describe('publisher', () => {
  it('sends created for a new user to superadmin connections only', async () => {
    await expect(handler({ Records: [record('INSERT', user)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(sentTo()).toEqual(['super']);
    expect(sentPayload()).toEqual({
      v: 1,
      topic: 'customers',
      type: 'created',
      id: 'sub-1',
      at: 1760000000000,
      data: { givenName: 'Ada', familyName: 'L', email: 'ada@example.com', mobilePhone: '+12505550100', createdAt: user.createdAt },
    });
    expect(ApiGatewayManagementApiClient).toHaveBeenCalledWith({ endpoint: process.env.WEBSOCKET_MANAGEMENT_ENDPOINT });
    expect(logger.info).toHaveBeenCalledWith('event=realtime_message_sent', expect.objectContaining({ connectionId: 'super', type: 'created' }));
  });

  it('reads the subscriber rows once per delivered record', async () => {
    await handler({ Records: [record('INSERT', user)] });
    expect(dynamodb.runQuery.mock.calls.filter(([q]) => q.TableName === 'AdminRealtimeTable')).toHaveLength(1);
    expect(sentTo()).toEqual(['super']);
  });

  it('sends nothing for a login', async () => {
    await handler({ Records: [record('MODIFY', { ...user, lastLogin: 'later' }, user)] });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sends added for a first completed booking to that park\'s staff only', async () => {
    await expect(handler({ Records: [record('MODIFY', completed, held)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(sentTo()).toEqual(['staff1']);
    expect(sentPayload()).toMatchObject({ type: 'added', id: 'sub-1', collectionId: 'bcparks_1', data: { givenName: 'Ada' } });
  });

  it('still sends added when the earlier booking was in another park', async () => {
    mockTx.bookings.push({ ...completed, bookingId: 'b0', collectionId: 'bcparks_2', bookingCompletionTime: 1 });
    await handler({ Records: [record('MODIFY', completed, held)] });
    expect(sentTo()).toEqual(['staff1']);
  });

  it('sends nothing for a second completed booking in the same park', async () => {
    mockTx.bookings.push({ ...completed, bookingId: 'b0', bookingCompletionTime: 1 });
    await handler({ Records: [record('MODIFY', completed, held)] });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sends one added when two bookings in a park complete together', async () => {
    const second = { ...completed, sk: '2026-10-10::b2', bookingId: 'b2' };
    mockTx.bookings.push(second);
    await handler({ Records: [record('MODIFY', completed, held, '1'), record('MODIFY', second, { ...held, bookingId: 'b2' }, '2')] });
    expect(sentTo()).toEqual(['staff1']);
  });

  it('sends nothing for a change to an already completed booking', async () => {
    await handler({ Records: [record('MODIFY', { ...completed, status: 'cancelled' }, completed)] });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('skips the transactional reads when nobody is subscribed', async () => {
    mockAdminRows.clear();
    await expect(handler({ Records: [record('MODIFY', completed, held)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(dynamodb.runQuery).toHaveBeenCalledTimes(1);
    expect(dynamodb.runQuery.mock.calls[0][0].TableName).toBe('AdminRealtimeTable');
    expect(dynamodb.getOne).not.toHaveBeenCalled();
  });

  it('closes connections past their token expiry instead of sending, and deletes their rows', async () => {
    connect('super-old', { superadmin: 'superadmin' }, Math.floor(Date.now() / 1000) - 1);
    connect('super-noexp', { superadmin: 'superadmin' }, null);
    await expect(handler({ Records: [record('INSERT', user)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(sentTo()).toEqual(['super']);
    expect(closes()).toEqual(['super-noexp', 'super-old']);
    expect(removeConnection.mock.calls.map(([id]) => id).sort()).toEqual(['super-noexp', 'super-old']);
    expect(mockAdminRows.has('CONN#super-old|META')).toBe(false);
    expect(mockAdminRows.has('TOPIC#customers|CONN#super-old')).toBe(false);
    expect(mockAdminRows.has('CONN#super-noexp|META')).toBe(false);
    expect(mockAdminRows.has('CONN#super|META')).toBe(true);
  });

  it('still deletes an expired connection\'s rows when the gateway already dropped it', async () => {
    connect('super-old', { superadmin: 'superadmin' }, 1);
    mockPost.mockImplementation(async (cmd) => {
      if (cmd.close) throw Object.assign(new Error('gone'), { name: 'GoneException', $metadata: { httpStatusCode: 410 } });
      return {};
    });
    await handler({ Records: [record('INSERT', user)] });
    expect(mockAdminRows.has('CONN#super-old|META')).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('removes a gone connection through the store and keeps sending to the others', async () => {
    connect('super2', { superadmin: 'superadmin' });
    mockPost.mockImplementation(async ({ post }) => {
      if (post?.ConnectionId === 'super') throw Object.assign(new Error('gone'), { name: 'GoneException', $metadata: { httpStatusCode: 410 } });
      return {};
    });
    await expect(handler({ Records: [record('INSERT', user)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(sentTo()).toEqual(['super', 'super2']);
    expect(removeConnection).toHaveBeenCalledWith('super');
    expect(removeConnection).toHaveBeenCalledTimes(1);
    expect(mockAdminRows.has('CONN#super|META')).toBe(false);
    expect(mockAdminRows.has('CONN#super2|META')).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('event=realtime_message_sent', expect.objectContaining({ connectionId: 'super2' }));
    expect(logger.info).not.toHaveBeenCalledWith('event=realtime_message_sent', expect.objectContaining({ connectionId: 'super' }));
  });

  it('logs a non-gone send failure for that connection and does not fail the record', async () => {
    connect('super2', { superadmin: 'superadmin' });
    mockPost.mockImplementation(async ({ post }) => {
      if (post?.ConnectionId === 'super') throw Object.assign(new Error('slow down'), { name: 'LimitExceededException', $metadata: { httpStatusCode: 429 } });
      return {};
    });
    await expect(handler({ Records: [record('INSERT', user)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(logger.warn).toHaveBeenCalledWith('event=realtime_send_failed', expect.objectContaining({ connectionId: 'super', error: 'LimitExceededException' }));
    expect(logger.info).toHaveBeenCalledWith('event=realtime_message_sent', expect.objectContaining({ connectionId: 'super2' }));
    expect(removeConnection).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports a failing record and stops, so the stream retries from it', async () => {
    dynamodb.getOne.mockRejectedValueOnce(new Error('throttled'));
    const res = await handler({
      Records: [record('INSERT', user, undefined, '1'), record('MODIFY', completed, held, '2'), record('INSERT', user, undefined, '3')],
    });
    expect(res).toEqual({ batchItemFailures: [{ itemIdentifier: '2' }] });
    expect(sentTo()).toEqual(['super']);
    expect(logger.error).toHaveBeenCalledWith('event=realtime_publish_failed', expect.objectContaining({ sequenceNumber: '2' }));
  });

  it('logs realtime_publish_failed on every failed attempt', async () => {
    dynamodb.getOne.mockRejectedValue(new Error('throttled'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(handler({ Records: [record('MODIFY', completed, held, '7')] })).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: '7' }] });
    }
    expect(logger.error.mock.calls.filter(([msg]) => msg === 'event=realtime_publish_failed')).toHaveLength(2);
  });

  it('never logs personal data', async () => {
    mockPost.mockImplementation(async ({ post }) => {
      if (post?.ConnectionId === 'staff1') throw Object.assign(new Error('boom'), { name: 'InternalServerErrorException' });
      return {};
    });
    await handler({ Records: [record('INSERT', user), record('MODIFY', completed, held, '2')] });
    const logged = JSON.stringify([logger.info, logger.warn, logger.error, logger.debug].map((fn) => fn.mock.calls));
    expect(logged).not.toMatch(/ada@example\.com|Ada|2505550100/);
  });
});

describe('publisher with staff added switched off', () => {
  beforeEach(() => { delete process.env.REALTIME_STAFF_ADDED_ENABLED; });

  it('sends nothing and reads nothing from the transactional table for a completed booking', async () => {
    await expect(handler({ Records: [record('MODIFY', completed, held)] })).resolves.toEqual({ batchItemFailures: [] });
    expect(mockPost).not.toHaveBeenCalled();
    expect(dynamodb.getOne).not.toHaveBeenCalled();
    expect(dynamodb.runQuery.mock.calls.every(([q]) => q.TableName === 'AdminRealtimeTable')).toBe(true);
  });

  it('still sends created to superadmins', async () => {
    await handler({ Records: [record('INSERT', user)] });
    expect(sentTo()).toEqual(['super']);
  });
});

describe('publisher source routing', () => {
  const loadWith = (sources, topics) => {
    let loaded;
    jest.isolateModules(() => {
      if (sources === undefined) delete process.env.REALTIME_SOURCES;
      else process.env.REALTIME_SOURCES = sources;
      jest.doMock('../../src/handlers/admin-realtime/topics', () => ({ TOPICS: topics }));
      jest.doMock('../../src/handlers/admin-realtime/publish', () => ({
        subscribers: jest.fn(async () => ['c1']),
        publish: jest.fn(async () => ({ sent: 1, failed: 0, gone: 0, expired: 0 })),
      }));
      loaded = {
        publisher: require('../../src/handlers/admin-realtime/publisher'),
        publish: require('../../src/handlers/admin-realtime/publish').publish,
      };
    });
    return loaded;
  };
  const resolvesTo = (type) => jest.fn(async () => ({ type, id: 'x' }));
  const fromTable = (table, seq) => ({ eventID: `e-${seq}`, eventSourceARN: streamArn(table), dynamodb: { SequenceNumber: seq } });

  afterEach(() => {
    jest.dontMock('../../src/handlers/admin-realtime/topics');
    jest.dontMock('../../src/handlers/admin-realtime/publish');
    process.env.REALTIME_SOURCES = JSON.stringify({ TxTable: 'transactional' });
  });

  it('sends each record only to the topics of its own source', async () => {
    const topics = {
      customers: { source: 'transactional', resolve: resolvesTo('created'), audience: () => true },
      passes: { source: 'reference', resolve: resolvesTo('changed'), audience: () => true },
      direct: { source: null, audience: () => true },
    };
    const { publisher, publish } = loadWith(JSON.stringify({ TxTable: 'transactional', RefTable: 'reference' }), topics);

    const res = await publisher.handler({ Records: [fromTable('TxTable', '1'), fromTable('RefTable', '2')] });

    expect(res).toEqual({ batchItemFailures: [] });
    expect(topics.customers.resolve).toHaveBeenCalledTimes(1);
    expect(topics.customers.resolve.mock.calls[0][0].eventSourceARN).toBe(streamArn('TxTable'));
    expect(topics.passes.resolve).toHaveBeenCalledTimes(1);
    expect(topics.passes.resolve.mock.calls[0][0].eventSourceARN).toBe(streamArn('RefTable'));
    expect(publish.mock.calls.map(([topic]) => topic)).toEqual(['customers', 'passes']);
  });

  it('skips a record from an unmapped table with a warning and no batch failure', async () => {
    const topics = { customers: { source: 'transactional', resolve: resolvesTo('created'), audience: () => true } };
    const { publisher, publish } = loadWith(JSON.stringify({ TxTable: 'transactional' }), topics);

    const res = await publisher.handler({ Records: [fromTable('OtherTable', '1'), fromTable('TxTable', '2')] });

    expect(res).toEqual({ batchItemFailures: [] });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unmapped table'), expect.objectContaining({ table: 'OtherTable' }));
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
