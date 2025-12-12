const { handler } = require("../../src/handlers/bookings/GET/public");
let getBookingByBookingId, getBookingsByUserId;

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
    this.msg = message;
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
  getRequestClaimsFromEvent: jest.fn(),
}));

jest.mock('../../src/handlers/bookings/methods', () => ({
  getBookingByBookingId: jest.fn(),
  getBookingsByUserId: jest.fn(),
}));

const { getRequestClaimsFromEvent } = require('/opt/base');
({ getBookingByBookingId, getBookingsByUserId } = require('../../src/handlers/bookings/methods'));


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

  it('should get booking by bookingId with email verification', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b1' },
      queryStringParameters: { email: 'test@example.com' }
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b1',
      namedOccupant: {
        contactInfo: {
          email: 'test@example.com'
        }
      }
    });
    getRequestClaimsFromEvent.mockReturnValue(null);
    
    const res = await handler(event, context);
    expect(getBookingByBookingId).toHaveBeenCalledWith('b1', false);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe('b1');
  });

  it('should reject booking lookup with mismatched email', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b1' },
      queryStringParameters: { email: 'wrong@example.com' }
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b1',
      namedOccupant: {
        contactInfo: {
          email: 'test@example.com'
        }
      }
    });
    getRequestClaimsFromEvent.mockReturnValue(null);
    
    const res = await handler(event, context);
    expect(res.status).toBe(403);
  });

  it('should get booking by bookingId with userId verification', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b2' }
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b2',
      userId: 'user123'
    });
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    
    const res = await handler(event, context);
    expect(getBookingByBookingId).toHaveBeenCalledWith('b2', false);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe('b2');
  });

  it('should reject booking lookup with mismatched userId', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b2' }
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b2',
      userId: 'user123'
    });
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'wronguser' });
    
    const res = await handler(event, context);
    expect(res.status).toBe(403);
  });

  it('should get bookings by userId with filters', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        collectionId: 'col1',
        activityType: 'frontcountryCamp',
        activityId: 'act1',
        startDate: '2024-01-01',
        endDate: '2024-01-02'
      }
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockResolvedValue([{ id: 'b3' }, { id: 'b4' }]);
    
    const res = await handler(event, context);
    expect(getBookingsByUserId).toHaveBeenCalledWith('user123', {
      collectionId: 'col1',
      activityType: 'frontcountryCamp',
      activityId: 'act1',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      bookingId: undefined,
      fetchAccessPoints: false
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(2);
  });

  it('should get bookings with fetchAccessPoints flag', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        fetchAccessPoints: 'true'
      }
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockResolvedValue([]);
    
    const res = await handler(event, context);
    expect(getBookingsByUserId).toHaveBeenCalledWith('user123', expect.objectContaining({
      fetchAccessPoints: 'true'
    }));
    expect(res.status).toBe(200);
  });

  it('should handle errors and return error response', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {}
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockRejectedValue({
      code: 500,
      msg: 'DB error',
      error: 'Database connection failed'
    });
    
    const res = await handler(event, context);
    expect(res.status).toBe(500);
  });

  it('should handle errors without code property', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {}
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockRejectedValue(new Error('Unknown error'));
    
    const res = await handler(event, context);
    expect(res.status).toBe(400);
  });
});
