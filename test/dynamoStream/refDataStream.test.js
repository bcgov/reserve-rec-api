'use strict';

const mockBatchWriteData = jest.fn();
const mockBulkWrite = jest.fn();
jest.mock('/opt/dynamodb', () => {
  const { marshall, unmarshall } = jest.requireActual('@aws-sdk/util-dynamodb');
  return {
    marshall, unmarshall,
    batchWriteData: (...a) => mockBatchWriteData(...a),
    runQuery: jest.fn(),
    AUDIT_TABLE_NAME: 'audit',
    PUBSUB_TABLE_NAME: 'pubsub',
    USER_ID_PARTITION: 'userid',
  };
});
jest.mock('/opt/opensearch', () => ({
  OPENSEARCH_REFERENCE_DATA_INDEX_NAME: 'ref-index',
  bulkWriteDocuments: (...a) => mockBulkWrite(...a),
}));

const { marshall } = require('@aws-sdk/util-dynamodb');
const { handler } = require('../../src/handlers/dynamoStream/refDataStream');

let sequence = 0;
const record = (eventName, keys, { newImage, oldImage } = {}) => ({
  eventName,
  dynamodb: {
    ApproximateCreationDateTime: 1700000000,
    SequenceNumber: String(++sequence),
    Keys: marshall(keys),
    ...(newImage && { NewImage: marshall(newImage) }),
    ...(oldImage && { OldImage: marshall(oldImage) }),
  },
});

describe('reference data stream', () => {
  beforeEach(() => {
    sequence = 0;
    mockBatchWriteData.mockReset().mockResolvedValue();
    mockBulkWrite.mockReset().mockResolvedValue();
  });

  it('upserts searchable schemas into the reference index keyed pk#sk', async () => {
    const res = await handler({
      Records: [
        record('INSERT', { pk: 'collection::bcparks_7', sk: 'base' }, { newImage: { pk: 'collection::bcparks_7', sk: 'base', schema: 'collection', displayName: 'Golden Ears' } }),
        record('MODIFY', { pk: 'activity::bcparks_7', sk: 'dayuse::1' }, { newImage: { pk: 'activity::bcparks_7', sk: 'dayuse::1', schema: 'activity' } }),
      ],
    }, {});

    expect(res.statusCode).toBe(200);
    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    expect(mockBulkWrite).toHaveBeenCalledWith([
      { pk: 'collection::bcparks_7', sk: 'base', schema: 'collection', displayName: 'Golden Ears', id: 'collection::bcparks_7#base' },
      { pk: 'activity::bcparks_7', sk: 'dayuse::1', schema: 'activity', id: 'activity::bcparks_7#dayuse::1' },
    ], 'ref-index');
  });

  it('removes soft-deleted and REMOVEd items from the index', async () => {
    await handler({
      Records: [
        record('MODIFY', { pk: 'facility::bcparks_7', sk: 'trail::9' }, { newImage: { schema: 'facility', isDeleted: true } }),
        record('REMOVE', { pk: 'product::bcparks_7::dayuse::1', sk: 'p1' }, { oldImage: { schema: 'product' } }),
      ],
    }, {});

    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    expect(mockBulkWrite).toHaveBeenCalledWith(
      [{ id: 'facility::bcparks_7#trail::9' }, { id: 'product::bcparks_7::dayuse::1#p1' }],
      'ref-index',
      'delete',
    );
  });

  it('writes one audit row per indexed change, attributed to lastModifiedBy or system', async () => {
    await handler({
      Records: [
        record('INSERT', { pk: 'geozone::bcparks_7', sk: 'g1' }, { newImage: { schema: 'geozone', lastModifiedBy: 'admin-1' } }),
        record('REMOVE', { pk: 'geozone::bcparks_7', sk: 'g2' }, { oldImage: { schema: 'geozone' } }),
      ],
    }, {});

    const [rows, chunk, table] = mockBatchWriteData.mock.calls[0];
    expect(chunk).toBe(25);
    expect(table).toBe('audit');
    expect(rows.map(({ pk, sk, gsipk, gsisk, operation }) => ({ pk, sk, gsipk, gsisk, operation }))).toEqual([
      { pk: { S: 'admin-1' }, sk: { S: '2023-11-14T22:13:20.000Z#1' }, gsipk: { S: 'geozone::bcparks_7' }, gsisk: { S: 'g1' }, operation: { S: 'INSERT' } },
      { pk: { S: 'system' }, sk: { S: '2023-11-14T22:13:20.000Z#2' }, gsipk: { S: 'geozone::bcparks_7' }, gsisk: { S: 'g2' }, operation: { S: 'REMOVE' } },
    ]);
  });

  it('skips user partition rows and non-searchable schemas entirely', async () => {
    const res = await handler({
      Records: [
        record('INSERT', { pk: 'userid', sk: 'sub-1' }, { newImage: { schema: 'user' } }),
        record('INSERT', { pk: 'policy::x', sk: 'base' }, { newImage: { schema: 'policy' } }),
      ],
    }, {});

    expect(res.statusCode).toBe(200);
    expect(mockBulkWrite).not.toHaveBeenCalled();
    expect(mockBatchWriteData).toHaveBeenCalledWith([], 25, 'audit');
  });
});
