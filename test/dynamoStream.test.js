jest.mock('/opt/opensearch', () => ({
  OPENSEARCH_REFERENCE_DATA_INDEX_NAME: 'ref-index',
  OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: 'trans-index',
  OPENSEARCH_USER_INDEX_NAME: 'user-index',
  bulkWriteDocuments: jest.fn(),
}));

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  batchWriteData: jest.fn(),
}));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { bulkWriteDocuments } = require('/opt/opensearch');
const { batchWriteData } = require('/opt/dynamodb');
const refDataStream = require('../src/handlers/dynamoStream/refDataStream');
const transDataStream = require('../src/handlers/dynamoStream/transDataStream');

const refRecord = (eventName = 'MODIFY', sequence = '100') => ({
  eventName,
  dynamodb: {
    ApproximateCreationDateTime: 1700000000,
    SequenceNumber: sequence,
    Keys: { pk: { S: 'facility::bcparks_1' }, sk: { S: '1' } },
    NewImage: {
      pk: { S: 'facility::bcparks_1' },
      sk: { S: '1' },
      schema: { S: 'facility' },
      lastModifiedBy: { S: 'user-1' },
      capacity: { N: '4' },
    },
    OldImage: {
      pk: { S: 'facility::bcparks_1' },
      sk: { S: '1' },
      schema: { S: 'facility' },
      capacity: { N: '2' },
    },
  },
});

const bookingRecord = () => ({
  eventName: 'INSERT',
  dynamodb: {
    ApproximateCreationDateTime: 1700000000,
    Keys: { pk: { S: 'booking::1' }, sk: { S: 'a' } },
    NewImage: { pk: { S: 'booking::1' }, sk: { S: 'a' }, schema: { S: 'booking' } },
  },
});

describe('dynamo stream handlers', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('refDataStream', () => {
    it('rejects when the OpenSearch write fails so the mapping retries', async () => {
      bulkWriteDocuments.mockRejectedValueOnce(new Error('opensearch down'));
      await expect(refDataStream.handler({ Records: [refRecord()] }, {})).rejects.toThrow('opensearch down');
      expect(batchWriteData).not.toHaveBeenCalled();
    });

    it('rejects when the audit write fails', async () => {
      batchWriteData.mockRejectedValueOnce(new Error('audit down'));
      await expect(refDataStream.handler({ Records: [refRecord()] }, {})).rejects.toThrow('audit down');
    });

    it('writes audit images as single-marshalled maps', async () => {
      await refDataStream.handler({ Records: [refRecord()] }, {});

      const [[items, , table]] = batchWriteData.mock.calls;
      expect(table).toBe('audit');
      const audit = unmarshall(items[0]);
      expect(audit.pk).toBe('user-1');
      expect(audit.operation).toBe('MODIFY');
      expect(audit.newImage).toEqual({
        pk: 'facility::bcparks_1',
        sk: '1',
        schema: 'facility',
        lastModifiedBy: 'user-1',
        capacity: 4,
      });
      expect(audit.oldImage).toMatchObject({ capacity: 2 });
    });
  });

  describe('refDataStream audit keys', () => {
    it('gives same-second records from one user distinct keys in one batch write', async () => {
      await refDataStream.handler({ Records: [refRecord('MODIFY', '100'), refRecord('MODIFY', '101')] }, {});

      expect(batchWriteData).toHaveBeenCalledTimes(1);
      const items = batchWriteData.mock.calls[0][0];
      const keys = items.map((item) => `${unmarshall(item).pk}|${unmarshall(item).sk}`);
      expect(items).toHaveLength(2);
      expect(new Set(keys).size).toBe(2);
    });

    it('audits a REMOVE under the user from the old image', async () => {
      const record = refRecord('REMOVE');
      delete record.dynamodb.NewImage;
      record.dynamodb.OldImage.lastModifiedBy = { S: 'user-2' };

      await refDataStream.handler({ Records: [record] }, {});

      const audit = unmarshall(batchWriteData.mock.calls[0][0][0]);
      expect(audit.pk).toBe('user-2');
      expect(audit.operation).toBe('REMOVE');
      expect(audit.oldImage).toMatchObject({ capacity: 2 });
      expect(audit.newImage).toBeUndefined();
    });
  });

  describe('transDataStream', () => {
    it('never writes audit rows', async () => {
      await transDataStream.handler({ Records: [bookingRecord()] }, {});
      expect(bulkWriteDocuments).toHaveBeenCalled();
      expect(batchWriteData).not.toHaveBeenCalled();
    });

    it('rejects when the OpenSearch write fails so the mapping retries', async () => {
      bulkWriteDocuments.mockRejectedValueOnce(new Error('opensearch down'));
      await expect(transDataStream.handler({ Records: [bookingRecord()] }, {})).rejects.toThrow('opensearch down');
    });
  });
});
