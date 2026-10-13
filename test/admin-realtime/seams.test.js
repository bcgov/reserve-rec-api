// End to end: authorizer -> connect -> subscribe -> publisher -> disconnect, run against the
// real handlers, the real store.js and the real /opt/dynamodb helpers. Only the AWS clients are faked:
// DynamoDB (in-memory, marshalled rows) and the API Gateway management API (records posts).

const mockTables = new Map();
const mockPosts = [];
const mockState = { earlierBookings: [], goneConnections: new Set() };

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  const rows = (name) => {
    if (!mockTables.has(name)) mockTables.set(name, new Map());
    return mockTables.get(name);
  };
  const keyOf = (key) => `${key.pk.S}|${key.sk.S}`;
  const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

  function execute(cmd) {
    const input = cmd.input;
    if (cmd instanceof actual.PutItemCommand) {
      rows(input.TableName).set(keyOf(input.Item), input.Item);
      return {};
    }
    if (cmd instanceof actual.GetItemCommand) {
      return { Item: rows(input.TableName).get(keyOf(input.Key)) };
    }
    if (cmd instanceof actual.DeleteItemCommand) {
      const table = rows(input.TableName);
      const old = table.get(keyOf(input.Key));
      if (!old && input.ConditionExpression) throw conditionFailed();
      table.delete(keyOf(input.Key));
      return input.ReturnValues === 'ALL_OLD' && old ? { Attributes: old } : {};
    }
    if (cmd instanceof actual.BatchGetItemCommand) {
      const [[tableName, { Keys }]] = Object.entries(input.RequestItems);
      return { Responses: { [tableName]: Keys.map((k) => rows(tableName).get(keyOf(k))).filter(Boolean) } };
    }
    if (cmd instanceof actual.QueryCommand) {
      if (input.TableName === 'AdminRealtimeTable') {
        if (input.KeyConditionExpression !== 'pk = :pk') throw new Error(`unexpected query: ${input.KeyConditionExpression}`);
        const pk = input.ExpressionAttributeValues[':pk'].S;
        return { Items: [...rows(input.TableName).values()].filter((item) => item.pk.S === pk) };
      }
      return { Items: mockState.earlierBookings };
    }
    throw new Error(`unexpected command ${cmd.constructor.name}`);
  }

  class DynamoDBClient {
    send(cmd, cb) {
      let result;
      try {
        result = execute(cmd);
      } catch (err) {
        if (cb) return cb(err);
        return Promise.reject(err);
      }
      return cb ? cb(null, result) : Promise.resolve(result);
    }
  }
  return { ...actual, DynamoDBClient };
});

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn(() => ({
    send: jest.fn(async (input) => {
      if (mockState.goneConnections.has(input.ConnectionId)) {
        throw Object.assign(new Error('gone'), { name: 'GoneException' });
      }
      mockPosts.push({ connectionId: input.ConnectionId, message: JSON.parse(input.Data) });
    }),
  })),
  PostToConnectionCommand: jest.fn((input) => input),
}));

const mockClaims = {};
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: async (token) => mockClaims[token] }) },
}));

jest.mock('/opt/base', () => ({
  ...jest.requireActual('/opt/base'),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

process.env.ADMIN_REALTIME_TABLE_NAME = 'AdminRealtimeTable';
process.env.TRANSACTIONAL_DATA_TABLE_NAME = 'TxTable';
process.env.REFERENCE_DATA_TABLE_NAME = 'RefTable';
process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = 'https://abc.execute-api.ca-central-1.amazonaws.com/ws';
process.env.ADMIN_USER_POOL_ID = 'ca-central-1_abc';
process.env.ADMIN_USER_POOL_CLIENT_ID = 'client';
process.env.REALTIME_SOURCES = JSON.stringify({ TxTable: 'transactional' });

const { marshall } = require('@aws-sdk/util-dynamodb');
const authorizer = require('../../src/handlers/admin-realtime/authorizer');
const connect = require('../../src/handlers/admin-realtime/connect');
const subscribe = require('../../src/handlers/admin-realtime/subscribe');
const disconnect = require('../../src/handlers/admin-realtime/disconnect');
const publisher = require('../../src/handlers/admin-realtime/publisher');

const SUPERADMIN_GROUP = 'ca-central-1_abc-AdminIdentityStack-SuperAdminGroup';
const rows = (name) => mockTables.get(name) ?? new Map();
const connRows = () => [...rows('AdminRealtimeTable').keys()].sort();
const TOKEN_EXP = 4102444800; // 2100-01-01, never expired in these tests

// Registers an admin pool token. tier null = superadmin; otherwise a user record with {collectionId: tier}.
function admin(token, sub, permissions) {
  const superadmin = permissions === null;
  mockClaims[token] = { sub, username: `user-${sub}`, exp: TOKEN_EXP, 'cognito:groups': superadmin ? [SUPERADMIN_GROUP] : ['staff'] };
  if (!superadmin) {
    if (!mockTables.has('RefTable')) mockTables.set('RefTable', new Map());
    mockTables.get('RefTable').set(`userid::${sub}|base`, marshall({ pk: `userid::${sub}`, sk: 'base', permissions }));
  }
}

// authorizer -> connect, using the authorizer's own context as the $connect request context.
async function connectAs(token, connectionId) {
  const auth = await authorizer.handler({ methodArn: 'arn:execute-api:ca-central-1:1:abc/ws/$connect', queryStringParameters: { token } });
  const connected = await connect.handler({ requestContext: { connectionId, authorizer: auth.context } });
  return { auth, connected };
}

const subscribeTo = (connectionId, topic) => subscribe.handler({
  requestContext: { connectionId },
  body: JSON.stringify({ action: 'subscribe', topic }),
});

const streamRecord = (eventName, newItem, oldItem) => ({
  eventName,
  eventID: 'evt-1',
  eventSourceARN: 'arn:aws:dynamodb:ca-central-1:123456789012:table/TxTable/stream/2026-10-01T00:00:00.000',
  dynamodb: {
    SequenceNumber: '100',
    ApproximateCreationDateTime: 1760000000,
    Keys: marshall({ pk: newItem.pk, sk: newItem.sk }),
    NewImage: marshall(newItem),
    ...(oldItem && { OldImage: marshall(oldItem) }),
  },
});

const userRow = { pk: 'user', sk: 'sub-customer', schema: 'user', givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', createdAt: '2026-10-01T00:00:00.000Z' };
const customerData = { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', createdAt: '2026-10-01T00:00:00.000Z' };

beforeEach(() => {
  mockTables.clear();
  mockPosts.length = 0;
  mockState.earlierBookings = [];
  mockState.goneConnections.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.REALTIME_STAFF_ADDED_ENABLED;
});

describe('admin realtime: connect -> subscribe -> publisher', () => {
  test('with staff added off, staff is refused at $connect and a new sign-up reaches the superadmin', async () => {
    admin('tok-super', 'sub-super', null);
    admin('tok-staff', 'sub-staff', { PARK1: 'staff' });
    expect((await connectAs('tok-super', 'c-super')).connected).toEqual({ statusCode: 200 });
    const staff = await connectAs('tok-staff', 'c-staff');
    expect(staff.auth.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(staff.connected.statusCode).toBe(400);
    expect(JSON.parse((await subscribeTo('c-super', 'customers')).body)).toEqual({ type: 'subscribed', topic: 'customers' });

    const result = await publisher.handler({ Records: [streamRecord('INSERT', userRow)] });

    expect(connRows()).toEqual(['CONN#c-super|META', 'TOPIC#customers|CONN#c-super']);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockPosts).toEqual([{
      connectionId: 'c-super',
      message: { v: 1, topic: 'customers', type: 'created', id: 'sub-customer', at: 1760000000000, data: customerData },
    }]);
  });

  test('with staff added on, staff connects and subscribes but a new sign-up reaches only the superadmin', async () => {
    process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';
    admin('tok-super', 'sub-super', null);
    admin('tok-staff', 'sub-staff', { PARK1: 'staff' });
    expect((await connectAs('tok-super', 'c-super')).connected).toEqual({ statusCode: 200 });
    expect((await connectAs('tok-staff', 'c-staff')).connected).toEqual({ statusCode: 200 });
    expect(JSON.parse((await subscribeTo('c-super', 'customers')).body)).toEqual({ type: 'subscribed', topic: 'customers' });
    expect(JSON.parse((await subscribeTo('c-staff', 'customers')).body)).toEqual({ type: 'subscribed', topic: 'customers' });

    const result = await publisher.handler({ Records: [streamRecord('INSERT', userRow)] });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockPosts).toEqual([{
      connectionId: 'c-super',
      message: { v: 1, topic: 'customers', type: 'created', id: 'sub-customer', at: 1760000000000, data: customerData },
    }]);
  });

  async function completeFirstBookingWithThreeAdmins() {
    admin('tok-super', 'sub-super', null);
    admin('tok-park1', 'sub-park1', { PARK1: 'staff' });
    admin('tok-park2', 'sub-park2', { PARK2: 'staff' });
    for (const [token, id] of [['tok-super', 'c-super'], ['tok-park1', 'c-park1'], ['tok-park2', 'c-park2']]) {
      await connectAs(token, id);
      await subscribeTo(id, 'customers');
    }
    mockTables.set('TxTable', new Map([['user|sub-customer', marshall(userRow)]]));
    const pending = { pk: 'booking::sub-customer', sk: 'B1', schema: 'booking', userId: 'sub-customer', collectionId: 'PARK1', bookingId: 'B1' };
    return publisher.handler({
      Records: [streamRecord('MODIFY', { ...pending, bookingCompletionTime: 1760000000000 }, pending)],
    });
  }

  test('with staff added on, a first completed booking reaches only the staff admin of that collection', async () => {
    process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';

    const result = await completeFirstBookingWithThreeAdmins();

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockPosts).toEqual([{
      connectionId: 'c-park1',
      message: { v: 1, topic: 'customers', type: 'added', id: 'sub-customer', at: 1760000000000, collectionId: 'PARK1', data: customerData },
    }]);
  });

  test('with staff added unset, a first completed booking reaches nobody', async () => {
    const result = await completeFirstBookingWithThreeAdmins();

    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockPosts).toEqual([]);
  });

  test('a disconnected admin has no META or TOPIC row left and receives nothing', async () => {
    admin('tok-super', 'sub-super', null);
    await connectAs('tok-super', 'c-gone');
    await subscribeTo('c-gone', 'customers');
    expect(connRows()).toEqual(['CONN#c-gone|META', 'TOPIC#customers|CONN#c-gone']);

    expect(await disconnect.handler({ requestContext: { connectionId: 'c-gone' } })).toEqual({ statusCode: 200 });
    const result = await publisher.handler({ Records: [streamRecord('INSERT', userRow)] });

    expect(connRows()).toEqual([]);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockPosts).toEqual([]);
  });

  test('a limited-tier admin is refused at $connect and receives nothing', async () => {
    admin('tok-limited', 'sub-limited', { PARK1: 'limited' });
    const { auth, connected } = await connectAs('tok-limited', 'c-limited');

    const result = await publisher.handler({ Records: [streamRecord('INSERT', userRow)] });

    expect(auth.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(connected.statusCode).toBe(400);
    expect(rows('AdminRealtimeTable').size).toBe(0);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(mockPosts).toEqual([]);
  });

  test('a connection the gateway reports gone is cleaned up by the publisher', async () => {
    admin('tok-super', 'sub-super', null);
    await connectAs('tok-super', 'c-stale');
    await subscribeTo('c-stale', 'customers');
    mockState.goneConnections.add('c-stale');

    const result = await publisher.handler({ Records: [streamRecord('INSERT', userRow)] });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(connRows()).toEqual([]);
  });
});
