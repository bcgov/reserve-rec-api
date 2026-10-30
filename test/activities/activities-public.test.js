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
}));

process.env.WAITING_ROOM_TABLE_NAME = 'WaitingRoom';

const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOne, runQuery } = require('/opt/dynamodb');
const { handler } = require('../../src/handlers/activities/_collectionId/GET/public');

const COL = 'bcparks_1';
const get = (queryStringParameters) => handler({ pathParameters: { collectionId: COL }, queryStringParameters });
const parse = (res) => JSON.parse(res.body);
const queueItem = (meta) => ({ Item: marshall(meta) });
const requestedKeys = () => mockSend.mock.calls.map(([cmd]) => unmarshall(cmd.input.Key).pk);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-10-30T18:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  getOne.mockResolvedValue({ displayName: 'Joffre Lakes' });
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

  it("falls back to today's global queue when the facility has none", async () => {
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce(queueItem({ queueStatus: 'open' }));

    const res = await get(single);

    expect(requestedKeys()).toEqual([`QUEUE#${COL}#dayuse#4#2026-11-01`, 'QUEUE#MODE2#global#1#2026-10-30']);
    expect(parse(res).data.waitingRoomActive).toBe(true);
  });

  it.each([
    ['is closed', queueItem({ queueStatus: 'closed' })],
    ['does not exist', {}],
  ])('reports inactive when the global queue %s', async (_label, mode2) => {
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce(mode2);
    const res = await get(single);
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
