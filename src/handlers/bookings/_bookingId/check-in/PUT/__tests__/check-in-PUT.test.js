"use strict";

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
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
  getRequestClaimsFromEvent: jest.fn((event) => {
    const authHeader = event?.headers?.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    try {
      const payloadBase64 = token.split(".")[1];
      const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf-8");
      return JSON.parse(payloadJson);
    } catch (e) {
      return null;
    }
  }),
  calculatePartySize: jest.fn(() => 4),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  batchWriteData: jest.fn(),
  marshall: jest.fn((value) => value),
  AUDIT_TABLE_NAME: "AuditTable",
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

jest.mock("../../../../../bookings/methods", () => ({
  getBookingByBookingId: jest.fn(),
}));

const { handler } = require("../admin");
const { getBookingByBookingId } = require("../../../../../bookings/methods");
const { batchTransactData } = require("/opt/dynamodb");
const { writeAuditLog } = require("/opt/base");

function makeToken(sub) {
  const base64Payload = Buffer.from(JSON.stringify({ sub })).toString("base64");
  return `header.${base64Payload}.signature`;
}

function makeEvent({ bookingId = "booking-123", sub = "admin-123", body = {} } = {}) {
  const headers = sub ? { Authorization: `Bearer ${makeToken(sub)}` } : {};
  return {
    httpMethod: "PUT",
    pathParameters: { bookingId },
    body: JSON.stringify(body),
    headers,
  };
}

const BOOKING_ID = "booking-123";
const ADMIN_ID = "admin-123";

const baseBooking = {
  bookingId: BOOKING_ID,
  status: "confirmed",
  pk: "booking::1",
  sk: "1",
  reservationContext: {
    checkInTime: new Date("2026-06-11T08:00:00Z").getTime(), // Window starts
    checkOutTime: new Date("2026-06-11T20:00:00Z").getTime(),  // Window ends
  }
};

describe("Bookings Check-In PUT handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation
    getBookingByBookingId.mockResolvedValue({ ...baseBooking });
    batchTransactData.mockResolvedValue({});
    
    // Mock current time to 12pm on June 11, 2026
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns 200 for OPTIONS request", async () => {
    const result = await handler({ httpMethod: "OPTIONS" }, {});
    expect(result.status).toBe(200);
  });

  it("returns 401 and handles missing pathParameters in audit log", async () => {
    // Pass an event completely missing pathParameters and auth
    const event = { 
      httpMethod: "PUT", 
      headers: {},
      requestContext: { identity: {} }
    };
    const result = await handler(event, {});
    
    expect(result.status).toBe(401);
    expect(writeAuditLog).toHaveBeenCalledWith(
      "UNAUTHORIZED",
      "unknown",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
      expect.any(Function),
      "AuditTable"
    );
  });

  it("returns 401 when there is no auth token", async () => {
    const event = makeEvent({ sub: null });
    const result = await handler(event, {});
    expect(result.status).toBe(401);
    expect(result.message).toContain("Unauthorized");
  });

  it("returns 400 when booking status is not confirmed", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: "pending" });
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain('Booking has status "pending" and cannot be checked in');
  });

  it("returns 400 when booking is already checked in", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, checkedInTime: 123456789 });
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("is already checked in");
  });

  it("returns 400 when checking in before scheduled check-in time (different day)", async () => {
    // System time is June 10th, but check-in time is June 11th
    jest.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    getBookingByBookingId.mockResolvedValue({
      ...baseBooking,
      reservationContext: {
        checkInTime: new Date("2026-06-11T08:00:00Z").getTime(),
        checkOutTime: new Date("2026-06-11T20:00:00Z").getTime(),
      }
    });
    
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("cannot be checked in until");
  });

  it("returns 400 when checking in after scheduled checkout time", async () => {
    // System time is 12pm, but window ended at 10am
    jest.setSystemTime(new Date("2026-06-11T12:00:00Z"));
    getBookingByBookingId.mockResolvedValue({
      ...baseBooking,
      reservationContext: {
        checkOutTime: new Date("2026-06-11T10:00:00Z").getTime(),
      }
    });
    
    const event = makeEvent({});
    const result = await handler(event, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("cannot be checked in after");
  });

  it("returns 400 and default message for unhandled errors", async () => {
    // Simulate a raw, unexpected crash (DynamoDB timeout)
    const rawError = new Error("DynamoDB connection lost");
    getBookingByBookingId.mockRejectedValue(rawError);
    
    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(400); 
    expect(result.error).toEqual(rawError);
  });

  it("writes a failure audit when booking status is invalid", async () => {
    getBookingByBookingId.mockResolvedValue({ ...baseBooking, status: "pending" });

    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(writeAuditLog).toHaveBeenCalledWith(
      ADMIN_ID,
      BOOKING_ID,
      "BOOKING-CHECK-IN-FAILED",
      expect.objectContaining({
        reason: "Booking status is not confirmed",
        status: "pending",
      }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("successfully checks in a booking", async () => {
    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data.message).toBe("Booking checked in");
    expect(batchTransactData).toHaveBeenCalledWith([
      {
        action: "Update",
        data: expect.objectContaining({
          TableName: "TransactionalDataTable",
          Key: {
            pk: { S: baseBooking.pk },
            sk: { S: baseBooking.sk },
          },
          UpdateExpression: expect.stringContaining("SET #checkedInTime = :checkedInTime"),
          ExpressionAttributeValues: expect.objectContaining({
            ":checkedInTime": { N: expect.any(String) },
            ":checkedInByUser": { S: ADMIN_ID },
          }),
        }),
      },
    ]);
    expect(writeAuditLog).toHaveBeenCalledWith(
      ADMIN_ID,
      BOOKING_ID,
      "BOOKING-CHECK-IN-SUCCESS",
      expect.objectContaining({
        status: "confirmed",
        partySize: 4,
        collectionId: undefined,
        activityType: undefined,
        startDate: undefined,
        endDate: undefined,
      }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });
});
