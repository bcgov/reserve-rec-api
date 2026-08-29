'use strict';

jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: jest.fn((x) => x),
}));

jest.mock('/opt/dynamodb', () => ({
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  getOneByGlobalId: jest.fn(),
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
  TRANSACTIONAL_DATA_TABLE_NAME: 'TxTable',
  SPARSE_GSI1_NAME: 'sparse-gsi-1',
  USERID_INDEX_NAME: 'userId-index',
  USERID_PROPERTY_NAME: 'userId',
}));

jest.mock('/opt/sns', () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });

jest.mock('../../lib/handlers/emailDispatch/utils', () => ({ sendConfirmationEmail: jest.fn() }));
jest.mock('../../src/handlers/activities/methods', () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock('../../src/common/data-utils', () => ({
  getAndAttachNestedProperties: jest.fn(),
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));
jest.mock('../../src/handlers/productDates/methods', () => ({ fetchProductDates: jest.fn() }));
jest.mock('../../src/handlers/productDates/configs', () => ({ PUBLIC_PRODUCTDATE_PROJECTIONS: {} }));
jest.mock('../../src/handlers/users/methods', () => ({ getUserInfoByUserName: jest.fn() }));
jest.mock('../../src/handlers/bookings/configs', () => ({
  BOOKING_PUT_CONFIG: {},
  BOOKINGDATES_PUT_CONFIG: {},
  BOOKING_UPDATE_CONFIG: {},
}));

const { runQuery } = require('/opt/dynamodb');
const { getBookingsByUserId } = require('../../src/handlers/bookings/methods');

describe('getBookingsByUserId', () => {
  const userId = 'cog-sub-123';

  beforeEach(() => {
    jest.clearAllMocks();
    runQuery.mockResolvedValue({ items: [] });
  });

  it('excludes bookingDate children by filtering the query on schema', async () => {
    await getBookingsByUserId(userId);

    const params = runQuery.mock.calls[0][0];
    expect(params.IndexName).toBe('userId-index');
    expect(params.FilterExpression).toBe('#schema = :schema');
    expect(params.ExpressionAttributeNames['#schema']).toBe('schema');
    expect(params.ExpressionAttributeValues[':schema']).toBe('booking');
  });

  it('merges the schema filter with the optional date filters', async () => {
    await getBookingsByUserId(userId, { startDate: '2026-01-01', endDate: '2026-12-31' });

    const params = runQuery.mock.calls[0][0];
    expect(params.FilterExpression).toBe(
      '#schema = :schema AND startDate >= :startDate AND endDate <= :endDate'
    );
    expect(params.ExpressionAttributeValues[':startDate']).toBe('2026-01-01');
    expect(params.ExpressionAttributeValues[':endDate']).toBe('2026-12-31');
  });

  it('merges the schema filter with a bookingId filter', async () => {
    await getBookingsByUserId(userId, { bookingId: 'b-1' });

    const params = runQuery.mock.calls[0][0];
    expect(params.FilterExpression).toBe('#schema = :schema AND bookingId = :bookingId');
  });

  it('queries oldest-first by default', async () => {
    await getBookingsByUserId(userId);

    expect(runQuery.mock.calls[0][0].ScanIndexForward).toBeUndefined();
  });

  it('queries newest-first when the caller asks for it', async () => {
    await getBookingsByUserId(userId, { scanIndexForward: false });

    expect(runQuery.mock.calls[0][0].ScanIndexForward).toBe(false);
  });

  it('passes limit and lastEvaluatedKey through to runQuery', async () => {
    const lastEvaluatedKey = { pk: 'booking::1', sk: '2026-01-01::x' };
    await getBookingsByUserId(userId, { limit: 20, lastEvaluatedKey });

    expect(runQuery).toHaveBeenCalledWith(expect.any(Object), 20, lastEvaluatedKey);
  });

  it('returns the runQuery result untouched', async () => {
    const result = { items: [{ bookingId: 'b-1' }], lastEvaluatedKey: { pk: 'x' } };
    runQuery.mockResolvedValue(result);

    await expect(getBookingsByUserId(userId)).resolves.toBe(result);
  });
});
