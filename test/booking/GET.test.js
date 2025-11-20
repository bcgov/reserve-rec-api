const { handler } = require("../../src/handlers/bookings/GET/public");
// Do not import getBookingByBookingId here, import it after jest.mock
let getBookingByBookingId, getBookingsByActivityDetails, getBookingsByUserSub;

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
}));
jest.mock('../../src/handlers/bookings/methods', () => ({
  getBookingByBookingId: jest.fn(),
  getBookingsByActivityDetails: jest.fn(),
  getBookingsByUserSub: jest.fn(),
}));

// Import the mocked functions after jest.mock
({ getBookingByBookingId, getBookingsByActivityDetails, getBookingsByUserSub } = require('../../src/handlers/bookings/methods'));


describe('Bookings GET handler', () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle CORS preflight OPTIONS request', async () => {
    const event = { httpMethod: 'OPTIONS' };
    const res = await handler(event, context);
    expect(res.status).toBe(200);
  });

  // it('should get booking by bookingId from pathParameters', async () => {
  //   const event = { httpMethod: 'GET', pathParameters: { bookingId: 'b1' } };
  //   getBookingByBookingId.mockResolvedValue({ id: 'b1' });
  //   const res = await handler(event, context);
  //   console.log('Booking by bookingId response:', res);
  //   expect(res.data).toEqual({ id: 'b1' });
  // });

  // it('should get booking by bookingId from queryStringParameters', async () => {
  //   const event = { httpMethod: 'GET', queryStringParameters: { bookingId: 'b2' } };
  //   getBookingByBookingId.mockResolvedValue({ id: 'b2' });
  //   const res = await handler(event, context);
  //   expect(getBookingByBookingId).toHaveBeenCalledWith('b2');
  //   expect(res.data).toEqual({ id: 'b2' });
  // });

  // it('should get bookings by userSub', async () => {
  //   const event = { httpMethod: 'GET', queryStringParameters: { user: 'user1' } };
  //   getBookingsByUserSub.mockResolvedValue([{ id: 'b3' }]);
  //   const res = await handler(event, context);
  //   expect(getBookingsByUserSub).toHaveBeenCalledWith('user1');
  //   expect(res.data).toEqual([{ id: 'b3' }]);
  // });

  // it('should throw error if required activity details are missing', async () => {
  //   const event = { httpMethod: 'GET', queryStringParameters: {} };
  //   const res = await handler(event, context);
  //   expect(res.code).toBe(400);
  //   expect(res.msg).toMatch(/Booking ID.*are required/);
  // });

  // it('should get bookings by activity details', async () => {
  //   const event = {
  //     httpMethod: 'GET',
  //     pathParameters: {
  //       collectionId: 'ac1',
  //       activityType: 'type1',
  //       activityId: 'act1',
  //       startDate: '2024-01-01',
  //       endDate: '2024-01-02'
  //     }
  //   };
  //   getBookingsByActivityDetails.mockResolvedValue([{ id: 'b4' }]);
  //   const res = await handler(event, context);
  //   expect(getBookingsByActivityDetails).toHaveBeenCalledWith('ac1', 'type1', 'act1', '2024-01-01', '2024-01-02');
  //   expect(res.data).toEqual([{ id: 'b4' }]);
  // });

  // it('should handle errors and return error response', async () => {
  //   const event = {
  //     httpMethod: 'GET',
  //     pathParameters: {
  //       collectionId: 'ac1',
  //       activityType: 'type1',
  //       activityId: 'act1',
  //       startDate: '2024-01-01'
  //     }
  //   };
  //   getBookingsByActivityDetails.mockRejectedValue({ code: 500, msg: 'DB error', error: 'fail' });
  //   const res = await handler(event, context);
  //   expect(res.code).toBe(500);
  //   expect(res.msg).toBe('DB error');
  //   expect(res.err).toBe('fail');
  // });
});
