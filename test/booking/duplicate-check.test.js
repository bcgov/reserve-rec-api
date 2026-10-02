'use strict';

jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data?.data || null;
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

const { runQuery, getOne } = require('/opt/dynamodb');
const { fetchProductDates } = require('../../src/handlers/productDates/methods');
const { createBooking } = require('../../src/handlers/bookings/methods');

describe('createBooking refusals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const props = () => ({
    collectionId: 'col-1', activityType: 'dayuse', activityId: '1', productId: '3',
    startDate: '2026-06-15', invQuantity: 1, userId: 'cog-sub-123',
  });

  it.each([
    ['confirmed', 'has_booking'],
    ['in progress', 'has_hold'],
  ])('tags a %s duplicate as %s', async (status, refusal) => {
    runQuery.mockResolvedValue({ items: [{ bookingId: 'b-1', status, pk: 'booking::col-1::dayuse::1::3' }] });
    await expect(createBooking(props())).rejects.toMatchObject({
      code: 409,
      data: { existingBookingId: 'b-1', status, refusal },
    });
  });

  it('tags a missing property as invalid', async () => {
    await expect(createBooking({ ...props(), productId: undefined })).rejects.toMatchObject({
      code: 400, data: { refusal: 'invalid' },
    });
  });

  it('tags a product that does not exist as not_found', async () => {
    runQuery.mockResolvedValue({ items: [] });
    getOne.mockResolvedValue(null);
    await expect(createBooking(props())).rejects.toMatchObject({ code: 404, data: { refusal: 'not_found' } });
  });

  it('tags a product without dates as not_found', async () => {
    runQuery.mockResolvedValue({ items: [] });
    getOne.mockResolvedValue({ productId: '3' });
    fetchProductDates.mockResolvedValue([]);
    await expect(createBooking(props())).rejects.toMatchObject({ code: 404, data: { refusal: 'not_found' } });
  });
});
