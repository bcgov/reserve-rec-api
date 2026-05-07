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
const { findUserActiveBookingForProductOnDate } = require('../../src/handlers/bookings/methods');

describe('findUserActiveBookingForProductOnDate', () => {
  const userId = 'cog-sub-123';
  const productPk = 'booking::col-1::dayuse::1::3';
  const startDate = '2026-06-15';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no booking matches', async () => {
    runQuery.mockResolvedValue({ items: [] });
    const result = await findUserActiveBookingForProductOnDate(userId, productPk, startDate);
    expect(result).toBeNull();
  });

  it('returns the existing booking when one is found', async () => {
    const existing = { bookingId: 'b-1', status: 'confirmed', pk: productPk };
    runQuery.mockResolvedValue({ items: [existing] });
    const result = await findUserActiveBookingForProductOnDate(userId, productPk, startDate);
    expect(result).toBe(existing);
  });

  it('queries the userId-index with begins_with on sk and filters by pk + active statuses', async () => {
    runQuery.mockResolvedValue({ items: [] });
    await findUserActiveBookingForProductOnDate(userId, productPk, startDate);
    const params = runQuery.mock.calls[0][0];
    expect(params.IndexName).toBe('userId-index');
    expect(params.KeyConditionExpression).toContain('begins_with(sk, :startDatePrefix)');
    expect(params.FilterExpression).toContain('pk = :pk');
    expect(params.FilterExpression).toContain('#status IN (:inProgress, :confirmed)');
    expect(params.ExpressionAttributeValues[':startDatePrefix']).toBe(`${startDate}::`);
    expect(params.ExpressionAttributeValues[':pk']).toBe(productPk);
    expect(params.ExpressionAttributeValues[':inProgress']).toBe('in progress');
    expect(params.ExpressionAttributeValues[':confirmed']).toBe('confirmed');
  });

  it('returns null without querying when any required arg is missing', async () => {
    expect(await findUserActiveBookingForProductOnDate(null, productPk, startDate)).toBeNull();
    expect(await findUserActiveBookingForProductOnDate(userId, null, startDate)).toBeNull();
    expect(await findUserActiveBookingForProductOnDate(userId, productPk, null)).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
