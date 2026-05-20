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

  it('returns 401 when no auth token is present (single booking)', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b1' },
    };
    getRequestClaimsFromEvent.mockReturnValue(null);

    const res = await handler(event, context);
    expect(res.status).toBe(401);
    expect(getBookingByBookingId).not.toHaveBeenCalled();
  });

  it('returns 401 even if ?email= is provided (no anonymous lookup)', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b1' },
      queryStringParameters: { email: 'test@example.com' },
    };
    getRequestClaimsFromEvent.mockReturnValue(null);

    const res = await handler(event, context);
    expect(res.status).toBe(401);
    expect(getBookingByBookingId).not.toHaveBeenCalled();
  });

  it('ignores ?email= when authenticated — uses sub for ownership only', async () => {
    // Caller (Bob) is authenticated but tries to fetch Alice's booking by
    // passing Alice's email in the query string. The handler must use the
    // JWT sub, not the email, to decide ownership.
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b-alice' },
      queryStringParameters: { email: 'alice@example.com' },
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b-alice',
      userId: 'alice-sub',
      namedOccupant: { contactInfo: { email: 'alice@example.com' } },
    });
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'bob-sub' });

    const res = await handler(event, context);
    expect(res.status).toBe(403);
  });

  it('returns the booking when authenticated and sub matches userId', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b2' },
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b2',
      userId: 'user123',
    });
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });

    const res = await handler(event, context);
    expect(getBookingByBookingId).toHaveBeenCalledWith('b2', false);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe('b2');
  });

  it('returns 403 when authenticated but sub does not match booking owner', async () => {
    const event = {
      httpMethod: 'GET',
      pathParameters: { bookingId: 'b2' },
    };
    getBookingByBookingId.mockResolvedValue({
      id: 'b2',
      userId: 'user123',
    });
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'wronguser' });

    const res = await handler(event, context);
    expect(res.status).toBe(403);
  });

  it('returns 401 when listing bookings without auth', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: { collectionId: 'col1' },
    };
    getRequestClaimsFromEvent.mockReturnValue(null);

    const res = await handler(event, context);
    expect(res.status).toBe(401);
    expect(getBookingsByUserId).not.toHaveBeenCalled();
  });

  it('lists bookings by sub with filters when authenticated', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {
        collectionId: 'col1',
        activityType: 'frontcountryCamp',
        activityId: 'act1',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
      },
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
      fetchAccessPoints: false,
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveLength(2);
  });

  it('honors the fetchAccessPoints flag on list', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: { fetchAccessPoints: 'true' },
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockResolvedValue([]);

    const res = await handler(event, context);
    expect(getBookingsByUserId).toHaveBeenCalledWith('user123', expect.objectContaining({
      fetchAccessPoints: 'true',
    }));
    expect(res.status).toBe(200);
  });

  it('surfaces downstream errors with explicit code', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {},
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockRejectedValue({
      code: 500,
      msg: 'DB error',
      error: 'Database connection failed',
    });

    const res = await handler(event, context);
    expect(res.status).toBe(500);
  });

  it('falls back to 400 when the error has no code', async () => {
    const event = {
      httpMethod: 'GET',
      queryStringParameters: {},
    };
    getRequestClaimsFromEvent.mockReturnValue({ sub: 'user123' });
    getBookingsByUserId.mockRejectedValue(new Error('Unknown error'));

    const res = await handler(event, context);
    expect(res.status).toBe(400);
  });
});
