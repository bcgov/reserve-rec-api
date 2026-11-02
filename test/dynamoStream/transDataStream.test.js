'use strict';

const mockBulkWrite = jest.fn();
jest.mock('/opt/dynamodb', () => {
  const { marshall, unmarshall } = jest.requireActual('@aws-sdk/util-dynamodb');
  return { marshall, unmarshall, batchWriteData: jest.fn(), runQuery: jest.fn(), USER_ID_PARTITION: 'userid' };
});
jest.mock('/opt/opensearch', () => ({
  OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: 'trans-index',
  OPENSEARCH_USER_INDEX_NAME: 'user-index',
  bulkWriteDocuments: (...a) => mockBulkWrite(...a),
}));

const { marshall } = require('@aws-sdk/util-dynamodb');
const { handler } = require('../../src/handlers/dynamoStream/transDataStream');

const record = (eventName, keys, { newImage, oldImage } = {}) => ({
  eventName,
  dynamodb: {
    ApproximateCreationDateTime: 1700000000,
    Keys: marshall(keys),
    ...(newImage && { NewImage: marshall(newImage) }),
    ...(oldImage && { OldImage: marshall(oldImage) }),
  },
});
const callsFor = (index, action) => mockBulkWrite.mock.calls.filter(([, i, a]) => i === index && a === action).map(([docs]) => docs);

describe('transactional data stream', () => {
  beforeEach(() => mockBulkWrite.mockReset().mockResolvedValue());

  it('indexes bookings and users into their own indices with lastUpdated', async () => {
    const res = await handler({
      Records: [
        record('INSERT', { pk: 'booking::bcparks_7::dayuse::1::p1', sk: '2026-07-01::b1' }, { newImage: { schema: 'booking', bookingId: 'B-1' } }),
        record('MODIFY', { pk: 'userid::sub-1', sk: 'base' }, { newImage: { schema: 'user', email: 'a@example.com' } }),
      ],
    }, {});

    expect(res.statusCode).toBe(200);
    expect(callsFor('trans-index', 'index')).toEqual([[
      { schema: 'booking', bookingId: 'B-1', id: 'booking::bcparks_7::dayuse::1::p1#2026-07-01::b1', lastUpdated: '2023-11-14T22:13:20.000Z' },
    ]]);
    expect(callsFor('user-index', 'index')).toEqual([[
      { schema: 'user', email: 'a@example.com', id: 'userid::sub-1#base', lastUpdated: '2023-11-14T22:13:20.000Z' },
    ]]);
    expect(mockBulkWrite).toHaveBeenCalledTimes(2);
  });

  it('routes REMOVE by the old image schema', async () => {
    await handler({
      Records: [
        record('REMOVE', { pk: 'booking::x', sk: 's1' }, { oldImage: { schema: 'booking' } }),
        record('REMOVE', { pk: 'userid::sub-2', sk: 'base' }, { oldImage: { schema: 'user' } }),
      ],
    }, {});

    expect(callsFor('trans-index', 'delete')).toEqual([[{ id: 'booking::x#s1' }]]);
    expect(callsFor('user-index', 'delete')).toEqual([[{ id: 'userid::sub-2#base' }]]);
  });

  it('ignores inserts of schemas it does not index', async () => {
    const res = await handler({
      Records: [record('INSERT', { pk: 'transaction::x', sk: 's' }, { newImage: { schema: 'transaction' } })],
    }, {});
    expect(res.statusCode).toBe(200);
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
