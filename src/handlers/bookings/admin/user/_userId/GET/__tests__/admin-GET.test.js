"use strict";

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, options) {
    this.message = message;
    this.code = options?.code;
    this.data = options?.data || null;
    this.msg = message;
    this.error = options?.error || null;
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
  handleCORS: jest.fn(),
  checkAuthContext: jest.fn(),
}));

jest.mock("../../../../../methods", () => ({
  getBookingsByUserId: jest.fn(),
}));

const optBase = require("/opt/base");
const { handler } = require("../admin");
const { getBookingsByUserId } = require("../../../../../methods");

const MOCK_USER_ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

const MOCK_BOOKING = {
  pk: `booking::${MOCK_USER_ID}`,
  sk: "2026-07-01::abc123",
  bookingId: "abc123",
  userId: MOCK_USER_ID,
  displayName: "Joffre Lakes, Day-use pass",
  status: "confirmed",
  startDate: "2026-07-01",
  endDate: "2026-07-01",
  partySize: 2,
  reservationContext: {
    checkInTime: "2026-07-01T14:00:00.000Z",
    checkOutTime: "2026-07-02T02:00:00.000Z",
  },
};

function makeEvent({ pathParameters = {}, queryStringParameters = null } = {}) {
  return {
    httpMethod: "GET",
    pathParameters,
    queryStringParameters,
    requestContext: {
      authorizer: {
        principalId: "admin-1",
        permissions: JSON.stringify({ superadmin: "superadmin" }),
      },
    },
  };
}

describe("Bookings Admin User GET handler", () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
    optBase.handleCORS.mockReturnValue(null);
    optBase.checkAuthContext.mockReturnValue({
      sub: "admin-1",
      permissions: { superadmin: "superadmin" },
    });
  });

  it("requires the staff tier", async () => {
    await handler(makeEvent({ pathParameters: { userId: MOCK_USER_ID } }), context);
    expect(optBase.checkAuthContext).toHaveBeenCalledWith(expect.any(Object), "staff");
  });

  it("returns 403 when the caller is not staff", async () => {
    optBase.checkAuthContext.mockImplementationOnce(() => {
      throw new optBase.Exception("Unauthorized", { code: 403 });
    });

    const res = await handler(
      makeEvent({ pathParameters: { userId: MOCK_USER_ID } }),
      context
    );

    expect(res.status).toBe(403);
    expect(getBookingsByUserId).not.toHaveBeenCalled();
  });

  it("returns 400 when userId is missing", async () => {
    const res = await handler(makeEvent(), context);

    expect(res.status).toBe(400);
    expect(getBookingsByUserId).not.toHaveBeenCalled();
  });

  it("returns the customer's bookings", async () => {
    getBookingsByUserId.mockResolvedValue({ items: [MOCK_BOOKING] });

    const res = await handler(
      makeEvent({ pathParameters: { userId: MOCK_USER_ID } }),
      context
    );

    expect(res.status).toBe(200);
    expect(res.data.items).toEqual([MOCK_BOOKING]);
    expect(res.data.hasMore).toBe(false);
    expect(res.data.lastEvaluatedKey).toBeNull();
  });

  it("passes date filters and pagination through to the query", async () => {
    getBookingsByUserId.mockResolvedValue({ items: [] });

    await handler(
      makeEvent({
        pathParameters: { userId: MOCK_USER_ID },
        queryStringParameters: {
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          limit: "10",
          lastEvaluatedKey: JSON.stringify({ pk: "booking::1", sk: "2026-01-01::x" }),
        },
      }),
      context
    );

    expect(getBookingsByUserId).toHaveBeenCalledWith(MOCK_USER_ID, {
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      limit: 10,
      lastEvaluatedKey: { pk: "booking::1", sk: "2026-01-01::x" },
    });
  });

  it("surfaces the pagination key when more results remain", async () => {
    const lastEvaluatedKey = { pk: "booking::1", sk: "2026-07-01::abc123" };
    getBookingsByUserId.mockResolvedValue({ items: [MOCK_BOOKING], lastEvaluatedKey });

    const res = await handler(
      makeEvent({ pathParameters: { userId: MOCK_USER_ID } }),
      context
    );

    expect(res.status).toBe(200);
    expect(res.data.lastEvaluatedKey).toEqual(lastEvaluatedKey);
    expect(res.data.hasMore).toBe(true);
  });
});
