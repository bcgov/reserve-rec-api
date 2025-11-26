"use strict";

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
  // TODO: update this properly for cognito auth
  getRequestClaimsFromEvent: jest.fn((event) => {
    const authHeader = event?.headers?.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    // For testing, we will just decode the token as a base64 JSON string
    try {
      const payloadBase64 = token.split(".")[1];
      const payloadJson = Buffer.from(payloadBase64, "base64").toString("utf-8");
      const payload = JSON.parse(payloadJson);
      return { sub: payload.sub };
    } catch (e) {
      return null;
    }
  }),
}));

jest.mock("../../src/handlers/bookings/methods", () => ({
  getBookingByBookingId: jest.fn(),
  cancellationPublishCommand: jest.fn(),
}));

const { handler } = require("../../src/handlers/bookings/cancel/POST/index");
const {
  getBookingByBookingId,
  cancellationPublishCommand,
} = require("../../src/handlers/bookings/methods");

describe("Bookings Cancel POST handler", () => {
  const context = {};
  const mockBookingId = "booking-123";
  const mockUser = "user-456";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 200 for OPTIONS request (CORS)", async () => {
    const event = { httpMethod: "OPTIONS" };
    const result = await handler(event, context);
    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
  });

  it("should return 401 if user is not authenticated", async () => {
    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Test reason" }),
      headers: {},
    };
    const result = await handler(event, context);
    expect(result.status).toBe(401);
    expect(result.message).toBe("Unauthorized: User ID not found in request claims");
  });

  // Create a JWT token with the user sub
  const jwtPayload = { sub: mockUser };
  const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
    "base64"
  );
  const fakeToken = `header.${base64Payload}.signature`;

  it("should return 400 if bookingId is missing", async () => {
    const event = {
      httpMethod: "POST",
      pathParameters: {},
      body: JSON.stringify({ reason: "Test reason" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };
    const result = await handler(event, context);
    expect(result.status).toBe(400);
    expect(result.message).toBe("Booking ID required in request");
  });

  it("should extract user from JWT Bearer token", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: "user-from-jwt",
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-abc123",
    };

    const mockSNSResult = { MessageId: "sns-message-456" };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    cancellationPublishCommand.mockResolvedValue(mockSNSResult);

    // Create a simple JWT payload
    const jwtPayload = { sub: "user-from-jwt" };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Test" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(200);
  });

  it("should return 403 if user does not own the booking", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: "different-user",
      bookingStatus: "confirmed",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);

    // Create a JWT token with the mockUser
    const jwtPayload = { sub: mockUser };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Test" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(403);
    expect(result.message).toContain("does not own booking");
  });

  it("should successfully cancel a booking and publish to SNS", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: mockUser,
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-abc123",
      feeInformation: { total: 50.0 },
    };

    const mockSNSResult = {
      MessageId: "sns-message-123",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    cancellationPublishCommand.mockResolvedValue(mockSNSResult);

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Change of plans" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(getBookingByBookingId).toHaveBeenCalledWith(mockBookingId);
    expect(cancellationPublishCommand).toHaveBeenCalledWith(
      mockBooking,
      "Change of plans"
    );
    expect(result.status).toBe(200);
    expect(result.message).toBe("Success");
    expect(result.data.message).toBe("Booking cancellation initiated");
    expect(result.data.bookingId).toBe(mockBookingId);
    expect(result.data.messageId).toBe("sns-message-123");
  });

  it("should return 400 if booking is already cancelled", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: mockUser,
      bookingStatus: "cancelled",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);

    // Create a JWT token with the mockUser
    const jwtPayload = { sub: mockUser };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Test" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(400);
    expect(result.message).toContain("already cancelled");
  });

  it("should handle cancellation without a reason", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: mockUser,
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-abc123",
    };

    const mockSNSResult = { MessageId: "sns-message-789" };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    cancellationPublishCommand.mockResolvedValue(mockSNSResult);

    // Create a JWT token with the mockUser
    const jwtPayload = { sub: mockUser };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({}),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(cancellationPublishCommand).toHaveBeenCalledWith(
      mockBooking,
      undefined
    );
    expect(result.status).toBe(200);
  });

  it("should handle errors thrown by getBookingByBookingId", async () => {
    getBookingByBookingId.mockRejectedValue(
      new Error("Database connection error here :(")
    );

    // Create a JWT token with the mockUser
    const jwtPayload = { sub: mockUser };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Test" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(400);
    expect(result.message).toBe("Database connection error here :(");
  });

  it("should handle errors thrown by cancellationPublishCommand", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: mockUser,
      bookingStatus: "confirmed",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    cancellationPublishCommand.mockRejectedValue(
      new Error("SNS publish failed")
    );

    // Create a JWT token with the mockUser
    const jwtPayload = { sub: mockUser };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: JSON.stringify({ reason: "Test" }),
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(400);
    expect(result.message).toBe("SNS publish failed");
  });

  it("should handle missing body gracefully", async () => {
    const mockBooking = {
      bookingId: mockBookingId,
      userId: mockUser,
      bookingStatus: "confirmed",
    };

    const mockSNSResult = { MessageId: "sns-message-101" };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    cancellationPublishCommand.mockResolvedValue(mockSNSResult);

    // Create a JWT token with the mockUser
    const jwtPayload = { sub: mockUser };
    const base64Payload = Buffer.from(JSON.stringify(jwtPayload)).toString(
      "base64"
    );
    const fakeToken = `header.${base64Payload}.signature`;

    const event = {
      httpMethod: "POST",
      pathParameters: { bookingId: mockBookingId },
      body: null,
      headers: {
        Authorization: `Bearer ${fakeToken}`,
      },
    };

    const result = await handler(event, context);

    expect(result.status).toBe(200);
    expect(cancellationPublishCommand).toHaveBeenCalledWith(
      mockBooking,
      undefined
    );
  });
});
