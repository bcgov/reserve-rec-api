"use strict";

// Only the noisy/awkward parts of the base layer are stubbed. checkAuthContext and
// Exception are the real implementations, so the auth cases below exercise the actual
// permission-tier logic rather than a mock's return value.
jest.mock("/opt/base", () => {
  const actual = jest.requireActual("/opt/base");
  return {
    ...actual,
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
  };
});

jest.mock("../../../../../methods", () => ({
  getBookingsByUserId: jest.fn(),
}));

const { handler } = require("../admin");
const { getBookingsByUserId } = require("../../../../../methods");

const MOCK_USER_ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
const COLLECTION_ID = "bcparks_0001";

const MOCK_BOOKING = {
  pk: `booking::${MOCK_USER_ID}`,
  sk: "2026-07-01::abc123",
  schema: "booking",
  bookingId: "abc123",
  userId: MOCK_USER_ID,
  displayName: "Joffre Lakes, Day-use pass",
  status: "confirmed",
  startDate: "2026-07-01",
  endDate: "2026-07-01",
  quantity: 1,
  facilityDisplayName: "Joffre Lakes",
  geozoneDisplayName: "Sea to Sky",
  bookingCompletionTime: 1751328000000,
  partyContext: { adult: 2 },
  reservationContext: {
    checkInTime: "2026-07-01T14:00:00.000Z",
    checkOutTime: "2026-07-02T02:00:00.000Z",
  },
  // Attributes the customer detail cards must never receive
  feeContext: { total: 20 },
  namedOccupant: {
    firstName: "Jane",
    contactInfo: { email: "jane@example.com", mobilePhone: "2505550100" },
  },
  reservationPolicySnapshot: { some: "policy" },
};

const MOCK_BOOKING_DATE = {
  pk: `booking::${MOCK_USER_ID}`,
  sk: "2026-07-01::abc123::2026-07-01",
  schema: "bookingDate",
  bookingId: "abc123",
  userId: MOCK_USER_ID,
  startDate: "2026-07-01",
  quantity: 1,
};

const SUPERADMIN_PERMISSIONS = { superadmin: "superadmin" };
const STAFF_PERMISSIONS = { [COLLECTION_ID]: "staff" };
const LIMITED_PERMISSIONS = { [COLLECTION_ID]: "limited" };

function makeEvent({
  pathParameters = { userId: MOCK_USER_ID },
  queryStringParameters = null,
  permissions = SUPERADMIN_PERMISSIONS,
} = {}) {
  return {
    httpMethod: "GET",
    pathParameters,
    queryStringParameters,
    requestContext: {
      authorizer: {
        principalId: "admin-1",
        permissions: JSON.stringify(permissions),
      },
    },
  };
}

describe("Bookings Admin User GET handler", () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
    getBookingsByUserId.mockResolvedValue({ items: [MOCK_BOOKING] });
  });

  describe("authorization", () => {
    it("rejects a caller who only holds the limited tier", async () => {
      const res = await handler(
        makeEvent({ permissions: LIMITED_PERMISSIONS }),
        context
      );

      expect(res.status).toBe(403);
      expect(getBookingsByUserId).not.toHaveBeenCalled();
    });

    it("rejects a caller with no permissions at all", async () => {
      const res = await handler(makeEvent({ permissions: {} }), context);

      expect(res.status).toBe(403);
      expect(getBookingsByUserId).not.toHaveBeenCalled();
    });

    it("allows a caller holding staff in at least one collection", async () => {
      const res = await handler(
        makeEvent({ permissions: STAFF_PERMISSIONS }),
        context
      );

      expect(res.status).toBe(200);
      expect(getBookingsByUserId).toHaveBeenCalled();
    });

    it("allows a superadmin", async () => {
      const res = await handler(
        makeEvent({ permissions: SUPERADMIN_PERMISSIONS }),
        context
      );

      expect(res.status).toBe(200);
      expect(getBookingsByUserId).toHaveBeenCalled();
    });
  });

  it("returns 400 when userId is missing", async () => {
    const res = await handler(makeEvent({ pathParameters: {} }), context);

    expect(res.status).toBe(400);
    expect(getBookingsByUserId).not.toHaveBeenCalled();
  });

  it("returns only the whitelisted booking fields", async () => {
    const res = await handler(makeEvent(), context);

    expect(res.status).toBe(200);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]).toEqual({
      pk: MOCK_BOOKING.pk,
      sk: MOCK_BOOKING.sk,
      bookingId: "abc123",
      displayName: "Joffre Lakes, Day-use pass",
      status: "confirmed",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
      quantity: 1,
      facilityDisplayName: "Joffre Lakes",
      geozoneDisplayName: "Sea to Sky",
      bookingCompletionTime: 1751328000000,
      partyContext: { adult: 2 },
      reservationContext: MOCK_BOOKING.reservationContext,
    });
  });

  it("does not leak fee, occupant contact or policy attributes", async () => {
    const res = await handler(makeEvent(), context);

    const booking = res.data.items[0];
    expect(booking.feeContext).toBeUndefined();
    expect(booking.namedOccupant).toBeUndefined();
    expect(booking.reservationPolicySnapshot).toBeUndefined();
    expect(booking.userId).toBeUndefined();
    expect(JSON.stringify(booking)).not.toContain("jane@example.com");
  });

  it("excludes bookingDate rows that share the userId index", async () => {
    getBookingsByUserId.mockResolvedValue({
      items: [MOCK_BOOKING, MOCK_BOOKING_DATE],
    });

    const res = await handler(makeEvent(), context);

    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0].sk).toBe(MOCK_BOOKING.sk);
  });

  it("requests newest-first ordering with a default limit", async () => {
    await handler(makeEvent(), context);

    expect(getBookingsByUserId).toHaveBeenCalledWith(MOCK_USER_ID, {
      startDate: null,
      endDate: null,
      limit: 20,
      lastEvaluatedKey: null,
      scanIndexForward: false,
    });
  });

  it("passes date filters and pagination through to the query", async () => {
    await handler(
      makeEvent({
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
      scanIndexForward: false,
    });
  });

  it("caps the limit at 100", async () => {
    await handler(
      makeEvent({ queryStringParameters: { limit: "5000" } }),
      context
    );

    expect(getBookingsByUserId).toHaveBeenCalledWith(
      MOCK_USER_ID,
      expect.objectContaining({ limit: 100 })
    );
  });

  it("returns 400 for a non-numeric limit", async () => {
    const res = await handler(
      makeEvent({ queryStringParameters: { limit: "many" } }),
      context
    );

    expect(res.status).toBe(400);
    expect(res.message).toContain("limit");
    expect(getBookingsByUserId).not.toHaveBeenCalled();
  });

  it("returns 400 rather than a raw parse error for a malformed lastEvaluatedKey", async () => {
    const res = await handler(
      makeEvent({ queryStringParameters: { lastEvaluatedKey: "{not json" } }),
      context
    );

    expect(res.status).toBe(400);
    expect(res.message).toContain("lastEvaluatedKey");
    expect(getBookingsByUserId).not.toHaveBeenCalled();
  });

  it("surfaces the pagination key when more results remain", async () => {
    const lastEvaluatedKey = { pk: "booking::1", sk: "2026-07-01::abc123" };
    getBookingsByUserId.mockResolvedValue({
      items: [MOCK_BOOKING],
      lastEvaluatedKey,
    });

    const res = await handler(makeEvent(), context);

    expect(res.status).toBe(200);
    expect(res.data.lastEvaluatedKey).toEqual(lastEvaluatedKey);
    expect(res.data.hasMore).toBe(true);
  });
});
