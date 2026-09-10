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

jest.mock('../../src/handlers/products/methods', () => ({
  getProductById: jest.fn()
}));

const { runQuery } = require('/opt/dynamodb');
const { DUP_PASS_TYPES, findBookingConflict, findUserActiveBookingsOnDate } = require('../../src/handlers/bookings/methods');
const { getProductById } = require('../../src/handlers/products/methods');
const DUP_DISPLAY_NAMES = {
  JOFFRE: {
    ALLDAY: 'Joffre Lakes Day-use Pass - All day'
  },
  CHEAKAMUS: {
    AM: 'Cheakamus Day-use Pass - AM',
    PM: 'Cheakamus Day-use Pass - PM',
  },
  WESTCANYON: {
    AM: 'West Canyon Trailhead Parking Lot - AM',
    PM: 'West Canyon Trailhead Parking Lot - PM',
  }
};

describe('findUserActiveBookingOnDate', () => {
  const userId = 'cog-sub-123';
  const startDate = '2026-09-09';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when userId is missing', async () => {
    const result = await findUserActiveBookingsOnDate(null, startDate);

    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('returns null when startDate is missing', async () => {
    const result = await findUserActiveBookingsOnDate(userId, null);

    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('returns booking items from db', async () => {
    const bookings = [
      {
        bookingId: 'booking-1',
        sk: '2026-09-08::user-1',
        userId: 'user-1',
        displayName: DUP_DISPLAY_NAMES.JOFFRE.ALLDAY,
        status: 'confirmed',
      },
      {
        bookingId: 'booking-2',
        sk: '2026-09-09::user-1',
        userId: 'user-1',
        displayName: DUP_DISPLAY_NAMES.CHEAKAMUS.AM,
        status: 'confirmed',
      }
    ];
    runQuery.mockResolvedValue({ items: bookings });

    const result = await findUserActiveBookingsOnDate(userId, startDate);

    expect(result).toEqual(bookings);
  });

  it('returns an empty array when db returns no items', async () => {
    runQuery.mockResolvedValue({});

    const result = await findUserActiveBookingsOnDate(userId, startDate);

    expect(result).toEqual([]);
  });


  it('returns an empty array when no bookings exist on the start date', async () => {
    runQuery.mockResolvedValue({});

    const result = await findUserActiveBookingsOnDate(userId, '2026-09-07');

    expect(result).toEqual([]);
  });

  it('returns one booking when one booking exists on the start date', async () => {
    const bookings = [
      {
        bookingId: 'booking-1',
        sk: '2026-09-09::user-1',
        userId: 'user-1',
        displayName: DUP_DISPLAY_NAMES.CHEAKAMUS.AM,
        status: 'confirmed',
      }
    ];
    runQuery.mockResolvedValue({ items: bookings });

    const result = await findUserActiveBookingsOnDate(userId, startDate);

    expect(result).toHaveLength(1)
    expect(result).toEqual(bookings);
  });

});

describe('findBookingConflict', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [DUP_DISPLAY_NAMES.CHEAKAMUS.AM, DUP_DISPLAY_NAMES.WESTCANYON.PM, null],
    [DUP_DISPLAY_NAMES.CHEAKAMUS.PM, DUP_DISPLAY_NAMES.WESTCANYON.AM, null],
    [DUP_DISPLAY_NAMES.CHEAKAMUS.AM, DUP_DISPLAY_NAMES.CHEAKAMUS.AM, {bookingId: 'booking-1', status: 'confirmed'}],
    [DUP_DISPLAY_NAMES.CHEAKAMUS.AM, DUP_DISPLAY_NAMES.WESTCANYON.AM, {bookingId: 'booking-1', status: 'confirmed'}],
    [DUP_DISPLAY_NAMES.CHEAKAMUS.PM, DUP_DISPLAY_NAMES.CHEAKAMUS.PM, {bookingId: 'booking-1', status: 'confirmed'}],
    [DUP_DISPLAY_NAMES.CHEAKAMUS.PM, DUP_DISPLAY_NAMES.WESTCANYON.PM, {bookingId: 'booking-1', status: 'confirmed'}],
    [DUP_DISPLAY_NAMES.JOFFRE.ALLDAY, DUP_DISPLAY_NAMES.JOFFRE.ALLDAY, {bookingId: 'booking-1', status: 'confirmed'}],
    [DUP_DISPLAY_NAMES.WESTCANYON.AM, DUP_DISPLAY_NAMES.JOFFRE.ALLDAY, {bookingId: 'booking-1', status: 'confirmed'}],
    [DUP_DISPLAY_NAMES.WESTCANYON.PM, DUP_DISPLAY_NAMES.JOFFRE.ALLDAY, {bookingId: 'booking-1', status: 'confirmed'}],
  ])(
    'detects conflicting bookings: %s vs. %s', 
    async (existingPassName, newBookingPassName, expectedResult) => {
      getProductById.mockResolvedValue({
        displayName: newBookingPassName
      });

      const existingBookings = [
        {
          bookingId: 'booking-1',
          userId: 'user-1',
          displayName: existingPassName,
          status: 'confirmed',
        }
      ];
      const newBooking = {
          bookingId: 'booking-2',
          userId: 'user-1',
          status: 'confirmed',
        }

      const result = await findBookingConflict(existingBookings, newBooking);

      expect(result).toEqual(expectedResult);
    }
  )
});
