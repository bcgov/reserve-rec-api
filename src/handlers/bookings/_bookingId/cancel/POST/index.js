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
const { Exception, logger, sendResponse, getRequestClaimsFromEvent,  } = require("/opt/base");
const { batchTransactData } = require("/opt/dynamodb");
const {
  cancellationPublishCommand,
  getBookingByBookingId,
  flagCancelledBooking
} = require("../../../methods");

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
    if (booking.status === "cancelled") {
      throw new Exception(`Booking ${bookingId} is already cancelled`, {
        code: 400,
      });
    }

    // Check if booking is in a cancellable state
    const cancellableStatuses = ['in progress', 'confirmed'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new Exception(
        `Booking has status "${booking.status}" and cannot be cancelled`,
        { code: 400 }
      );
    }

    // TODO: Add cancellation window validation when policy infrastructure is implemented
    // Should check booking.reservationPolicySnapshot.temporalWindows.cancellationWindow
    // to determine if current time is within allowed cancellation period

    // For now, by default - the cancellation must occur before the booking's checkout time, if it exists.

    const queryTime = new Date().getTime();

    console.log('queryTime', queryTime);

    const checkoutTime = booking?.reservationContext?.checkoutTime;

    console.log('checkoutTime', checkoutTime);

    if (checkoutTime && queryTime > checkoutTime) {
      throw new Exception(
        `Booking cannot be cancelled after the checkout time of ${new Date(checkoutTime).toISOString()}`,
        { code: 400 }
      );
    }

    // NOTE: because we are not yet issuing refunds, we can do a major shortcut here for the time being: instead of publishing a message to SNS and letting the subscriber handle the cancellation and refund, we can just update the booking `isPending` flag back to 'PENDING'. This will allow the expired Booking cleanup runner to pick up the cancelled booking alongside the other expired Bookings and return the related Inventory back to its respective pool. This is obviously not a long term solution, but it allows us to bypass the refund logic for now while still effectively cancelling the booking and freeing up inventory.

    // const result = await cancellationPublishCommand(booking, reason);

    const updateRequest = await flagCancelledBooking(booking, queryTime);

    const result = await batchTransactData(updateRequest);

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
