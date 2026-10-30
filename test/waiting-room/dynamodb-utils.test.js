'use strict';

process.env.WAITING_ROOM_TABLE_NAME = 'wr-table';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn(() => ({ send: mockSend })) };
});

const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const db = require('../../src/handlers/waiting-room/utils/dynamodb');

const queueId = 'QUEUE#golden-ears#camping#standard-sites#2025-06-15';
const ccf = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
const sent = (n = 0) => mockSend.mock.calls[n][0];
const sentValues = (n = 0) => unmarshall(sent(n).input.ExpressionAttributeValues);

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe('key helpers', () => {
  it('builds the queue pk and entry sk', () => {
    expect(db.buildQueueId('golden-ears', 'camping', 'standard-sites', '2025-06-15')).toBe(queueId);
    expect(db.buildEntrySk('u-1')).toBe('ENTRY#u-1');
    expect(db.TABLE_NAME).toBe('wr-table');
  });
});

describe('queue meta', () => {
  it('getQueueMeta reads the META row and unmarshalls it', async () => {
    mockSend.mockResolvedValue({ Item: marshall({ pk: queueId, sk: 'META', queueStatus: 'open' }) });
    await expect(db.getQueueMeta(queueId)).resolves.toEqual({ pk: queueId, sk: 'META', queueStatus: 'open' });
    expect(sent().constructor.name).toBe('GetItemCommand');
    expect(unmarshall(sent().input.Key)).toEqual({ pk: queueId, sk: 'META' });
    expect(sent().input.TableName).toBe('wr-table');
  });

  it('getQueueMeta returns null when the row is missing', async () => {
    await expect(db.getQueueMeta(queueId)).resolves.toBeNull();
  });

  it('createQueueMeta refuses to overwrite, putQueueMeta overwrites', async () => {
    await db.createQueueMeta({ pk: queueId, sk: 'META' });
    await db.putQueueMeta({ pk: queueId, sk: 'META' });
    expect(sent(0).input.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(sent(1).input.ConditionExpression).toBeUndefined();
    expect(unmarshall(sent(1).input.Item)).toEqual({ pk: queueId, sk: 'META' });
  });

  it('updateQueueMetaLastReleasedAt adds to admittedCount only for a positive increment', async () => {
    await db.updateQueueMetaLastReleasedAt(queueId, 1700000000, 3);
    await db.updateQueueMetaLastReleasedAt(queueId, 1700000001);
    expect(sent(0).input.UpdateExpression).toContain('ADD admittedCount :inc');
    expect(sentValues(0)).toEqual({ ':ts': 1700000000, ':inc': 3 });
    expect(sent(1).input.UpdateExpression).not.toContain('admittedCount');
    expect(sentValues(1)).toEqual({ ':ts': 1700000001 });
  });

  it('incrementAbandonedCount adds the count', async () => {
    await db.incrementAbandonedCount(queueId, 4);
    expect(sent().input.UpdateExpression).toBe('ADD abandonedCount :count');
    expect(sentValues()).toEqual({ ':count': 4 });
  });

  it('updateQueueMetaStatus guards on the expected status and reports a lost race as false', async () => {
    mockSend.mockRejectedValueOnce(ccf());
    await expect(db.updateQueueMetaStatus(queueId, 'releasing', 'randomizing')).resolves.toBe(false);
    expect(sent().input.ConditionExpression).toBe('queueStatus = :expected');
    expect(sentValues()).toMatchObject({ ':newStatus': 'releasing', ':expected': 'randomizing' });
  });

  it('updateQueueMetaStatus without an expected status is unconditional', async () => {
    await expect(db.updateQueueMetaStatus(queueId, 'closed')).resolves.toBe(true);
    expect(sent().input.ConditionExpression).toBeUndefined();
  });

  it('updateQueueMetaStatus rethrows other errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('throttled'));
    await expect(db.updateQueueMetaStatus(queueId, 'closed')).rejects.toThrow('throttled');
  });

  it('incrementQueueTotalEntries returns the new total', async () => {
    mockSend.mockResolvedValue({ Attributes: marshall({ totalEntries: 42 }) });
    await expect(db.incrementQueueTotalEntries(queueId)).resolves.toBe(42);
    expect(sent().input.ReturnValues).toBe('UPDATED_NEW');
  });

  it('incrementAdmittedCount sets the ceiling to max minus batch', async () => {
    await expect(db.incrementAdmittedCount(queueId, 10, 100)).resolves.toBe(true);
    expect(sentValues()).toEqual({ ':batch': 10, ':ceiling': 90 });
  });

  it('incrementAdmittedCount returns false when the ceiling would be exceeded', async () => {
    mockSend.mockRejectedValueOnce(ccf());
    await expect(db.incrementAdmittedCount(queueId, 10, 100)).resolves.toBe(false);
  });

  it('incrementAdmittedCount rethrows other errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(db.incrementAdmittedCount(queueId, 1, 2)).rejects.toThrow('boom');
  });

  it('decrementAdmittedCount swallows the floor condition but not other errors', async () => {
    mockSend.mockRejectedValueOnce(ccf());
    await expect(db.decrementAdmittedCount(queueId, 2)).resolves.toBeUndefined();
    expect(sent().input.ConditionExpression).toBe('admittedCount >= :count');
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(db.decrementAdmittedCount(queueId, 2)).rejects.toThrow('boom');
  });

  it('deleteQueueMeta deletes the META row', async () => {
    await db.deleteQueueMeta(queueId);
    expect(sent().constructor.name).toBe('DeleteItemCommand');
    expect(unmarshall(sent().input.Key)).toEqual({ pk: queueId, sk: 'META' });
  });
});

describe('queue entries', () => {
  it('getQueueEntry reads ENTRY#<user>', async () => {
    mockSend.mockResolvedValueOnce({ Item: marshall({ userId: 'u-1', status: 'waiting' }) });
    await expect(db.getQueueEntry(queueId, 'u-1')).resolves.toEqual({ userId: 'u-1', status: 'waiting' });
    expect(unmarshall(sent().input.Key)).toEqual({ pk: queueId, sk: 'ENTRY#u-1' });
    await expect(db.getQueueEntry(queueId, 'u-2')).resolves.toBeNull();
  });

  it('putQueueEntry writes the item unconditionally', async () => {
    await db.putQueueEntry({ pk: queueId, sk: 'ENTRY#u-1', status: 'waiting' });
    expect(unmarshall(sent().input.Item)).toEqual({ pk: queueId, sk: 'ENTRY#u-1', status: 'waiting' });
    expect(sent().input.ConditionExpression).toBeUndefined();
  });

  it('updateQueueEntryStatus adds extra SET attributes and the expected-status guard', async () => {
    await expect(db.updateQueueEntryStatus(queueId, 'u-1', 'expired', 'admitted', { reason: 'ttl' })).resolves.toBe(true);
    const input = sent().input;
    expect(input.UpdateExpression).toBe('SET #status = :newStatus, updatedAt = :now, #reason = :reason');
    expect(input.ExpressionAttributeNames).toEqual({ '#status': 'status', '#reason': 'reason' });
    expect(input.ConditionExpression).toBe('#status = :expected');
    expect(sentValues()).toMatchObject({ ':newStatus': 'expired', ':reason': 'ttl', ':expected': 'admitted' });
  });

  it('updateQueueEntryStatus returns false on a lost race and rethrows other errors', async () => {
    mockSend.mockRejectedValueOnce(ccf());
    await expect(db.updateQueueEntryStatus(queueId, 'u-1', 'expired', 'admitted')).resolves.toBe(false);
    mockSend.mockRejectedValueOnce(new Error('boom'));
    await expect(db.updateQueueEntryStatus(queueId, 'u-1', 'expired')).rejects.toThrow('boom');
  });

  it('abandonQueueEntry sets abandoned with an abandonedAt stamp and no guard', async () => {
    await db.abandonQueueEntry(queueId, 'u-1');
    expect(sent().input.ConditionExpression).toBeUndefined();
    expect(sentValues()).toEqual(expect.objectContaining({ ':newStatus': 'abandoned', ':abandonedAt': expect.any(Number) }));
  });

  it('setEntryAdmitting moves waiting to admitting with the token', async () => {
    await db.setEntryAdmitting(queueId, 'u-1', 'tok', 1700000600);
    expect(sentValues()).toMatchObject({
      ':newStatus': 'admitting', ':expected': 'waiting', ':admissionToken': 'tok', ':admissionExpiry': 1700000600,
    });
  });

  it('setEntryAdmitted moves admitting to admitted', async () => {
    await db.setEntryAdmitted(queueId, 'u-1');
    expect(sentValues()).toMatchObject({ ':newStatus': 'admitted', ':expected': 'admitting' });
  });

  it('setDisconnectedAt and setConnectionId update the entry row', async () => {
    await db.setDisconnectedAt(queueId, 'u-1');
    await db.setConnectionId(queueId, 'u-1', 'conn-9');
    expect(sent(0).input.UpdateExpression).toBe('SET disconnectedAt = :now');
    expect(sent(1).input.UpdateExpression).toBe('SET connectionId = :cid REMOVE disconnectedAt');
    expect(sentValues(1)).toEqual({ ':cid': 'conn-9' });
    expect(unmarshall(sent(1).input.Key)).toEqual({ pk: queueId, sk: 'ENTRY#u-1' });
  });
});

describe('queries and scans', () => {
  it('queryQueueEntries follows LastEvaluatedKey and filters by status', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [marshall({ userId: 'a' })], LastEvaluatedKey: marshall({ pk: 'k' }) })
      .mockResolvedValueOnce({ Items: [marshall({ userId: 'b' })] });
    await expect(db.queryQueueEntries(queueId, { statuses: ['waiting', 'admitted'] }))
      .resolves.toEqual([{ userId: 'a' }, { userId: 'b' }]);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(sent(1).input.ExclusiveStartKey).toEqual(marshall({ pk: 'k' }));
    expect(sent(0).input.FilterExpression).toBe('#status IN (:s0, :s1)');
    expect(sentValues(0)).toMatchObject({ ':s0': 'waiting', ':s1': 'admitted' });
  });

  it('queryQueueEntries without statuses has no filter and tolerates empty pages', async () => {
    mockSend.mockResolvedValueOnce({});
    await expect(db.queryQueueEntries(queueId)).resolves.toEqual([]);
    expect(sent().input.FilterExpression).toBeUndefined();
  });

  it('queryEntriesByUserId uses the userId GSI with active statuses by default', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [marshall({ userId: 'u-1', pk: 'Q1' })], LastEvaluatedKey: { pk: { S: 'x' } } })
      .mockResolvedValueOnce({});
    await expect(db.queryEntriesByUserId('u-1')).resolves.toEqual([{ userId: 'u-1', pk: 'Q1' }]);
    expect(sent().input.IndexName).toBe('userId-index');
    expect(sentValues()).toEqual({ ':sub': 'u-1', ':s0': 'waiting', ':s1': 'admitting', ':s2': 'admitted' });
  });

  it('queryEntriesByClientIp scopes to one queue on the clientIp GSI', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [marshall({ userId: 'u-1' })], LastEvaluatedKey: { pk: { S: 'x' } } })
      .mockResolvedValueOnce({ Items: [marshall({ userId: 'u-2' })] });
    await expect(db.queryEntriesByClientIp('10.0.0.1', queueId)).resolves.toHaveLength(2);
    expect(sent().input.IndexName).toBe('clientIp-index');
    expect(sentValues()).toMatchObject({ ':ip': '10.0.0.1', ':queueId': queueId });
  });

  it('scanQueuesByStatus pages through META rows of one status', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [marshall({ pk: 'Q1' })], LastEvaluatedKey: { pk: { S: 'Q1' } } })
      .mockResolvedValueOnce({ Items: [marshall({ pk: 'Q2' })] });
    await expect(db.scanQueuesByStatus('pre-open')).resolves.toEqual([{ pk: 'Q1' }, { pk: 'Q2' }]);
    expect(sent().constructor.name).toBe('ScanCommand');
    expect(sentValues()).toEqual({ ':meta': 'META', ':status': 'pre-open' });
  });

  it('scanAllQueueMetas pages through every QUEUE# META row', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [marshall({ pk: 'Q1' })], LastEvaluatedKey: { pk: { S: 'Q1' } } })
      .mockResolvedValueOnce({});
    await expect(db.scanAllQueueMetas()).resolves.toEqual([{ pk: 'Q1' }]);
    expect(sentValues()).toEqual({ ':meta': 'META', ':queuePrefix': 'QUEUE#' });
  });

  it('scanExpiredEntries adds the expiry condition only when both attr and threshold are given', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [marshall({ userId: 'u-1' })], LastEvaluatedKey: { pk: { S: 'x' } } })
      .mockResolvedValueOnce({});
    await expect(db.scanExpiredEntries('admitted', 'admissionExpiry', 0)).resolves.toEqual([{ userId: 'u-1' }]);
    expect(sent(0).input.FilterExpression).toBe('begins_with(sk, :entryPrefix) AND #status = :status AND #admissionExpiry < :threshold');
    expect(sentValues(0)).toMatchObject({ ':threshold': 0 });

    mockSend.mockReset().mockResolvedValue({});
    await db.scanExpiredEntries('admitting', 'admittedAt');
    expect(sent(0).input.FilterExpression).toBe('begins_with(sk, :entryPrefix) AND #status = :status');
  });
});

describe('connection records', () => {
  afterEach(() => jest.useRealTimers());

  it('put, get and delete use CONN#<id>/META', async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    await db.putConnectionRecord('c-1', queueId, 'u-1', 60);
    expect(unmarshall(sent(0).input.Item)).toEqual({ pk: 'CONN#c-1', sk: 'META', queueId, userId: 'u-1', ttl: 1_700_000_060 });

    mockSend.mockResolvedValueOnce({ Item: marshall({ queueId, userId: 'u-1' }) });
    await expect(db.getConnectionRecord('c-1')).resolves.toEqual({ queueId, userId: 'u-1' });
    await expect(db.getConnectionRecord('c-2')).resolves.toBeNull();

    await db.deleteConnectionRecord('c-1');
    expect(sent(3).constructor.name).toBe('DeleteItemCommand');
    expect(unmarshall(sent(3).input.Key)).toEqual({ pk: 'CONN#c-1', sk: 'META' });
  });
});

describe('batch writes', () => {
  afterEach(() => jest.useRealTimers());

  const entries = (n) => Array.from({ length: n }, (_, i) => ({ pk: queueId, sk: `ENTRY#u${i}`, randomOrder: i }));

  it('batchWriteEntries chunks into requests of 25', async () => {
    await db.batchWriteEntries(entries(30));
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(sent(0).input.RequestItems['wr-table']).toHaveLength(25);
    expect(sent(1).input.RequestItems['wr-table']).toHaveLength(5);
  });

  it('batchWriteEntries resends only the unprocessed items', async () => {
    jest.useFakeTimers();
    const leftover = [{ PutRequest: { Item: marshall({ pk: queueId, sk: 'ENTRY#u1' }) } }];
    mockSend.mockResolvedValueOnce({ UnprocessedItems: { 'wr-table': leftover } }).mockResolvedValueOnce({});
    const done = db.batchWriteEntries(entries(2));
    await jest.runAllTimersAsync();
    await done;
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(sent(1).input.RequestItems['wr-table']).toEqual(leftover);
  });

  it('batchWriteEntries throws when items stay unprocessed after 5 attempts', async () => {
    jest.useFakeTimers();
    const leftover = [{ PutRequest: { Item: marshall({ pk: queueId, sk: 'ENTRY#u1' }) } }];
    mockSend.mockResolvedValue({ UnprocessedItems: { 'wr-table': leftover } });
    const done = db.batchWriteEntries(entries(2));
    const assertion = expect(done).rejects.toThrow('batchWriteEntries: 1 item(s) still unprocessed after 5 retries');
    await jest.runAllTimersAsync();
    await assertion;
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it('batchDeleteItems chunks deletes and retries unprocessed ones', async () => {
    jest.useFakeTimers();
    const keys = Array.from({ length: 26 }, (_, i) => ({ pk: queueId, sk: `ENTRY#u${i}` }));
    const leftover = [{ DeleteRequest: { Key: marshall(keys[0]) } }];
    mockSend
      .mockResolvedValueOnce({ UnprocessedItems: { 'wr-table': leftover } })
      .mockResolvedValueOnce({ UnprocessedItems: {} })
      .mockResolvedValueOnce({});
    const done = db.batchDeleteItems(keys);
    await jest.runAllTimersAsync();
    await done;
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(unmarshall(sent(0).input.RequestItems['wr-table'][0].DeleteRequest.Key)).toEqual(keys[0]);
    expect(sent(1).input.RequestItems['wr-table']).toEqual(leftover);
    expect(sent(2).input.RequestItems['wr-table']).toHaveLength(1);
  });
});
