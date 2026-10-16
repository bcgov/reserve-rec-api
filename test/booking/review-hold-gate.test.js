'use strict';

jest.mock('/opt/base', () => ({
  Exception: jest.requireActual('/opt/base').Exception,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({ unmarshall: jest.fn((x) => x) }));

jest.mock('/opt/dynamodb', () => ({
  batchTransactData: jest.fn(),
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
jest.mock('../../lib/handlers/emailDispatch/utils', () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));
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
jest.mock('../../src/handlers/users/methods', () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
}));
jest.mock('../../src/handlers/bookings/configs', () => ({
  BOOKING_PUT_CONFIG: {},
  BOOKINGDATES_PUT_CONFIG: {},
  BOOKING_UPDATE_CONFIG: {},
}));

const { getUserInfoBySub } = require('../../src/handlers/users/methods');
const { fetchProductDates } = require('../../src/handlers/productDates/methods');
const { batchTransactData, getOne, getOneByGlobalId, runQuery } = require('/opt/dynamodb');
const { logger } = require('/opt/base');
const { GENERIC_FAILURE_MESSAGE } = require('../../src/handlers/bookings/refusals');
const { completeBooking, createBooking, requireReviewClear } = require('../../src/handlers/bookings/methods');

const user = (review) => ({ pk: 'user', sk: 'sub-1', ...(review ? { review } : {}) });
const verified = {
  Attributes: [
    { Name: 'given_name', Value: 'Test' },
    { Name: 'family_name', Value: 'User' },
    { Name: 'email', Value: 'someone@example.test' },
    { Name: 'email_verified', Value: 'true' },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('requireReviewClear', () => {
  it.each(['pending', 'rejected'])('refuses an account whose review is %s', async (state) => {
    getOne.mockResolvedValue(user({ state, source: 'refusal', matchedOn: 'phone', at: '2026-01-01T00:00:00.000Z' }));
    const error = await requireReviewClear('sub-1').catch((e) => e);

    expect(error).toMatchObject({ code: 400, message: GENERIC_FAILURE_MESSAGE, data: null, logRefusal: 'hold_gate' });
    expect(getOne).toHaveBeenCalledWith('user', 'sub-1', 'TxTable');
  });

  it.each([
    ['an approved review', user({ state: 'approved' })],
    ['no review', user()],
    ['no user record', null],
  ])('allows %s', async (_, record) => {
    getOne.mockResolvedValue(record);
    await expect(requireReviewClear('sub-1')).resolves.toBeUndefined();
  });

  it('fails open when the lookup fails', async () => {
    getOne.mockRejectedValue(new Error('dynamo down'));
    await expect(requireReviewClear('sub-1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Review state lookup failed open', { error: 'dynamo down' });
  });
});

describe('createBooking review gate', () => {
  const props = () => ({
    collectionId: 'c', activityType: 'dayuse', activityId: 'a', productId: 'p',
    startDate: '2026-07-01', endDate: '2026-07-01', invQuantity: 1, userId: 'sub-1',
  });

  it('refuses before reading bookings, the product or inventory', async () => {
    getOne.mockResolvedValue(user({ state: 'pending' }));
    await expect(createBooking(props())).rejects.toMatchObject({ message: GENERIC_FAILURE_MESSAGE, logRefusal: 'hold_gate' });

    expect(getOne).toHaveBeenCalledTimes(1);
    expect(runQuery).not.toHaveBeenCalled();
    expect(fetchProductDates).not.toHaveBeenCalled();
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('passes a clear account on to the booking checks', async () => {
    getOne.mockResolvedValueOnce(user()).mockResolvedValueOnce(null);
    runQuery.mockResolvedValue({ items: [] });
    await expect(createBooking(props())).rejects.toMatchObject({ data: { refusal: 'not_found' } });
    expect(runQuery).toHaveBeenCalled();
  });
});

describe('completeBooking review gate', () => {
  const hold = () => ({
    bookingId: 'b-1', userId: 'sub-1', status: 'in progress', sessionId: 's-1',
    sessionExpiry: Date.now() + 60_000, pk: 'pk', sk: 'sk',
  });

  beforeEach(() => {
    getOneByGlobalId.mockResolvedValue(hold());
    getUserInfoBySub.mockResolvedValue(verified);
    getOne.mockResolvedValue(user({ state: 'pending' }));
  });

  it('refuses with the generic failure and releases the hold', async () => {
    await expect(completeBooking('b-1', 's-1', { namedOccupant: {} }, { sub: 'sub-1' }))
      .rejects.toMatchObject({ code: 400, message: GENERIC_FAILURE_MESSAGE, data: null, logRefusal: 'hold_gate' });

    const [[update]] = batchTransactData.mock.calls[0];
    expect(update.data.ExpressionAttributeValues[':cancellationReason']).toEqual({ S: 'Booking refused' });
  });

  it('keeps the verified-email note on its own release', async () => {
    getUserInfoBySub.mockResolvedValue({ Attributes: [{ Name: 'email_verified', Value: 'false' }] });
    await expect(completeBooking('b-1', 's-1', { namedOccupant: {} }, { sub: 'sub-1' })).rejects.toMatchObject({ code: 403 });

    const [[update]] = batchTransactData.mock.calls[0];
    expect(update.data.ExpressionAttributeValues[':cancellationReason']).toEqual({ S: 'Booking refused: account email not verified' });
  });

  it('does not check once payment has started', async () => {
    const outcome = await completeBooking('b-1', 's-1', { namedOccupant: {} }, { sub: 'sub-1', paymentStarted: true })
      .catch((e) => e);

    expect(outcome?.message).not.toBe(GENERIC_FAILURE_MESSAGE);
    expect(getOne).not.toHaveBeenCalledWith('user', 'sub-1', 'TxTable');
    expect(batchTransactData).not.toHaveBeenCalled();
  });
});
