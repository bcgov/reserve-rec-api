'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
}));
jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  getOne: jest.fn(),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
}));

process.env.WAITING_ROOM_TABLE_NAME = 'WaitingRoom';

const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOne, runQuery, batchGetData } = require('/opt/dynamodb');
const { handler } = require('../../src/handlers/activities/_collectionId/GET/public');
const { clearActiveMode2Cache } = require('../../src/handlers/waiting-room/utils/dynamodb');

const COL = 'bcparks_1';
const get = (queryStringParameters) => handler({ pathParameters: { collectionId: COL }, queryStringParameters });
const parse = (res) => JSON.parse(res.body);
const queueItem = (meta) => ({ Item: marshall(meta) });
const requestedKeys = () => mockSend.mock.calls.map(([cmd]) => unmarshall(cmd.input.Key).pk);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-10-30T18:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  getOne.mockResolvedValue({ displayName: 'Joffre Lakes' });
  clearActiveMode2Cache();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('GET /activities/{collectionId} (public) waiting room status', () => {
  const single = { activityType: 'dayuse', activityId: '4', startDate: '2026-11-01' };

  it('reports an open facility queue and its opening time', async () => {
    mockSend.mockResolvedValueOnce(queueItem({ queueStatus: 'open', openingTime: '2026-10-30T14:00:00Z' }));

    const res = await get(single);

    expect(requestedKeys()).toEqual([`QUEUE#${COL}#dayuse#4#2026-11-01`]);
    expect(mockSend.mock.calls[0][0].input.TableName).toBe('WaitingRoom');
    expect(parse(res).data).toEqual({
      displayName: 'Joffre Lakes', waitingRoomActive: true, waitingRoomOpeningTime: '2026-10-30T14:00:00Z',
    });
  });

  it('reports a closed facility queue as inactive without an opening time', async () => {
    mockSend.mockResolvedValueOnce(queueItem({ queueStatus: 'closed', openingTime: 'x' }));
    const res = await get(single);
    expect(parse(res).data).toEqual({ displayName: 'Joffre Lakes', waitingRoomActive: false });
  });

  it('falls back to the active global queue named by the Mode 2 pointer, whatever the date', async () => {
    const mode2QueueId = 'QUEUE#MODE2#global#1#2026-10-29';
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(queueItem({ pk: 'MODE2', sk: 'ACTIVE', queueId: mode2QueueId }))
      .mockResolvedValueOnce(queueItem({ queueStatus: 'releasing' }));

    const res = await get(single);

    expect(requestedKeys()).toEqual([`QUEUE#${COL}#dayuse#4#2026-11-01`, 'MODE2', mode2QueueId]);
    expect(parse(res).data.waitingRoomActive).toBe(true);
  });

  it('reports inactive when the pointed-to global queue is closed', async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(queueItem({ pk: 'MODE2', sk: 'ACTIVE', queueId: 'QUEUE#MODE2#global#1#2026-10-30' }))
      .mockResolvedValueOnce(queueItem({ queueStatus: 'closed' }));
    const res = await get(single);
    expect(parse(res).data.waitingRoomActive).toBe(false);
  });

  it('reports inactive without reading a global queue when Mode 2 is off', async () => {
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const res = await get(single);
    expect(requestedKeys()).toEqual([`QUEUE#${COL}#dayuse#4#2026-11-01`, 'MODE2']);
    expect(parse(res).data.waitingRoomActive).toBe(false);
  });

  it('still returns the activity when the queue lookup fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('throttled'));
    const res = await get(single);
    expect(res.statusCode).toBe(200);
    expect(parse(res).data).toEqual({ displayName: 'Joffre Lakes' });
  });

  it('skips the queue lookup without a startDate', async () => {
    const res = await get({ activityType: 'dayuse', activityId: '4' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(parse(res).data).toEqual({ displayName: 'Joffre Lakes' });
  });
});

describe('GET /activities/{collectionId} (public) fetchFacilities', () => {
  const fac = (sk, extra) => ({ pk: `facility::${COL}`, sk, displayName: sk, ...extra });

  it('returns only visible, live facilities, without admin-only fields', async () => {
    runQuery.mockResolvedValue({ items: ['open', 'draft', 'gone'].map((sk) => ({ pk1: `facility::${COL}`, sk1: sk })) });
    batchGetData.mockResolvedValue([
      fac('open', { isVisible: true, adminNotes: 'n', version: 3, lastUpdated: 't', creationDate: 'c' }),
      fac('draft', { isVisible: false }),
      fac('gone', { isDeleted: true }),
    ]);

    const res = await get({ activityType: 'dayuse', activityId: '4', fetchFacilities: 'true' });

    expect(parse(res).data.facilities).toEqual([fac('open', { isVisible: true })]);
  });
});

describe('GET /activities/{collectionId} (public) lists', () => {
  const visibleClause = '(attribute_not_exists(#isVisible) OR #isVisible = :visible)';

  it('lists only visible activities of a type', async () => {
    runQuery.mockResolvedValue({ items: [{ sk: 'dayuse::1' }] });

    const res = await get({ activityType: 'dayuse' });

    const query = runQuery.mock.calls[0][0];
    expect(query.ExpressionAttributeValues[':sk']).toEqual({ S: 'dayuse::' });
    expect(query.FilterExpression).toBe(`(attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted) AND ${visibleClause}`);
    expect(query.ExpressionAttributeValues[':visible']).toEqual({ BOOL: true });
    expect(parse(res).data.items).toEqual([{ sk: 'dayuse::1' }]);
  });

  it('lists only visible activities across the collection, with filters', async () => {
    runQuery.mockResolvedValue({ items: [] });
    await get({ subActivityType: 'walkin' });
    const query = runQuery.mock.calls[0][0];
    expect(query.KeyConditionExpression).toBe('pk = :pk');
    expect(query.FilterExpression).toBe(
      `(contains(#subActivityType, :subActivityType)) AND (attribute_not_exists(#isDeleted) OR #isDeleted = :notDeleted) AND ${visibleClause}`,
    );
  });

  it('400s without a collectionId', async () => {
    const res = await handler({ pathParameters: {} });
    expect(res.statusCode).toBe(400);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('answers a CORS preflight', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
  });
});
