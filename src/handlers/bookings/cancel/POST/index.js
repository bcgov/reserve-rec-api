/** Cancel booking and initiate refund workflow via SNS
 * This Lambda function handles booking cancellation requests. It verifies the
 * user's ownership of the booking, checks if the booking is already cancelled,
 * and publishes a cancellation message to an SNS topic to trigger the refund
 * process.
 *
 * The actual cancellation and refund logic is handled asynchronously
 * by a subscriber Lambda functions found in /bookings/cancel/subscriber and
 * transactions/refunds/subscriber.
 */
const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const {
  cancellationPublishCommand,
  getBookingByBookingId,
} = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings Cancel POST:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Get booking ID from path parameters
    const bookingId = event?.pathParameters?.bookingId;
    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!userId) {
      throw new Exception("Unauthorized: User ID not found in request claims", { code: 401 });
    }

    if (!bookingId) {
      throw new Exception("Booking ID required in request", {
        code: 400,
      });
    }

    const body = JSON.parse(event?.body || "{}");
    const { reason } = body;

    const booking = await getBookingByBookingId(bookingId);

    // Verify ownership
    if (booking.userId !== userId) {
      throw new Exception(`User ${userId} does not own booking ${bookingId}`, {
        code: 403,
      });
    }

    // Check if booking is already cancelled
    if (booking.bookingStatus === "cancelled") {
      throw new Exception(`Booking ${bookingId} is already cancelled`, {
        code: 400,
      });
    }

    const result = await cancellationPublishCommand(booking, reason);

    logger.info(
      `Cancellation message published for booking ${bookingId}. Result: ${result}`
    );

    return sendResponse(
      200,
      {
        message: "Booking cancellation initiated",
        bookingId,
        messageId: result.MessageId,
        result: result,
      },
      "Success",
      null,
      context
    );
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error cancelling booking",
      error?.error || error,
      context
    );
  }
};
