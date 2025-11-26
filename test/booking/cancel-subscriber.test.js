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
  getNow: jest.fn(() => ({
    toISO: () => "2024-01-15T10:30:00.000Z",
  })),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  TRANSACTIONAL_DATA_TABLE_NAME: "TestTable",
}));

jest.mock("../../src/common/data-utils", () => ({
  quickApiUpdateHandler: jest.fn(),
}));

jest.mock("../../src/handlers/bookings/configs", () => ({
  BOOKING_UPDATE_CONFIG: {},
}));

jest.mock("../../src/handlers/bookings/methods", () => ({
  getBookingByBookingId: jest.fn(),
  refundPublishCommand: jest.fn(),
}));

const { handler } = require("../../src/handlers/bookings/cancel/subscriber/index");
const {
  getBookingByBookingId,
  refundPublishCommand,
} = require("../../src/handlers/bookings/methods");
const { batchTransactData } = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("../../src/common/data-utils");

describe("Booking Cancellation Subscriber", () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should skip non-SNS records", async () => {
    const event = {
      Records: [
        {
          EventSource: "aws:sqs",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Test",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).results).toEqual([]);
  });

  it("should successfully process a booking cancellation", async () => {
    const mockBooking = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2025-11-15",
      bookingId: "booking-123",
      userId: "user-123",
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-abc123",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });
    refundPublishCommand.mockResolvedValue({ MessageId: "refund-msg-123" });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Change of plans",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(getBookingByBookingId).toHaveBeenCalledWith("booking-123");
    expect(quickApiUpdateHandler).toHaveBeenCalled();
    expect(batchTransactData).toHaveBeenCalled();
    expect(refundPublishCommand).toHaveBeenCalledWith(
      mockBooking,
      "Change of plans"
    );

    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Cancellations processed");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe("cancelled");
    expect(body.results[0].clientTransactionId).toBe("BCPR-abc123");
  });

  it("should return 403 if user does not own the booking", async () => {
    const mockBooking = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2024-01-15",
      bookingId: "booking-123",
      userId: "different-user",
      bookingStatus: "confirmed",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Test",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("does not own booking");
  });

  it("should treat already cancelled booking as success", async () => {
    const mockBooking = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2024-01-15",
      bookingId: "booking-123",
      userId: "user-123",
      bookingStatus: "cancelled",
      clientTransactionId: "BCPR-abc123",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Test",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.results[0].status).toBe("already_cancelled");
    expect(quickApiUpdateHandler).not.toHaveBeenCalled();
  });

  it("should update booking with correct cancellation details", async () => {
    const mockBooking = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2024-01-15",
      bookingId: "booking-123",
      userId: "user-123",
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-abc123",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });
    refundPublishCommand.mockResolvedValue({ MessageId: "refund-msg-123" });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Emergency",
            }),
          },
        },
      ],
    };

    await handler(event, context);

    const updateCall = quickApiUpdateHandler.mock.calls[0];
    const updateData = updateCall[1][0];

    expect(updateData.key.pk).toBe(mockBooking.pk);
    expect(updateData.key.sk).toBe(mockBooking.sk);
    expect(updateData.data.bookingStatus.value).toBe("cancelled");
    expect(updateData.data.cancellationReason.value).toBe("Emergency");
    expect(updateData.data.cancelledAt.value).toBe("2024-01-15T10:30:00.000Z");
  });

  it("should not publish refund if no transaction exists", async () => {
    const mockBooking = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2024-01-15",
      bookingId: "booking-123",
      userId: "user-123",
      bookingStatus: "confirmed",
      clientTransactionId: null,
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Test",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(refundPublishCommand).not.toHaveBeenCalled();
    const body = JSON.parse(result.body);
    expect(body.results[0].clientTransactionId).toBe("no transaction");
  });

  it("should process multiple cancellations in batch", async () => {
    const mockBooking1 = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2024-01-15",
      bookingId: "booking-123",
      userId: "user-123",
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-abc123",
    };

    const mockBooking2 = {
      pk: "booking::bcparks_250::backcountryCamp::2",
      sk: "2024-01-16",
      bookingId: "booking-456",
      userId: "user-456",
      bookingStatus: "confirmed",
      clientTransactionId: "BCPR-def456",
    };

    getBookingByBookingId
      .mockResolvedValueOnce(mockBooking1)
      .mockResolvedValueOnce(mockBooking2);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });
    refundPublishCommand.mockResolvedValue({ MessageId: "refund-msg" });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Reason 1",
            }),
          },
        },
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-456",
              userId: "user-456",
              reason: "Reason 2",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe("cancelled");
    expect(body.results[1].status).toBe("cancelled");
  });

  it("should handle errors during booking update", async () => {
    const mockBooking = {
      pk: "booking::bcparks_250::backcountryCamp::1",
      sk: "2024-01-15",
      bookingId: "booking-123",
      userId: "user-123",
      bookingStatus: "confirmed",
    };

    getBookingByBookingId.mockResolvedValue(mockBooking);
    quickApiUpdateHandler.mockRejectedValue(new Error("Dynamo connection error!"));

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              bookingId: "booking-123",
              userId: "user-123",
              reason: "Test",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Dynamo connection error!");
  });
});
