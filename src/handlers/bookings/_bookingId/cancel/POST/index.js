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
const { batchTransactData } = require("/opt/dynamodb");
const {
  getBookingByBookingId,
  flagCancelledBooking,
  generateEmailParams,
  sendBookingCancellationEmail
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
    // Cap + sanitize the reason. DynamoDB items max out at 400KB, an admin UI
    // will eventually render this field, and CloudWatch operators will read it
    // in logs — so strip ASCII control chars (except \t, \n, \r) defensively
    // at the boundary, then cap length.
    const REASON_MAX_LENGTH = 1000;
    let reason = typeof body?.reason === "string" ? body.reason : undefined;
    if (reason) {
      // eslint-disable-next-line no-control-regex
      reason = reason.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
      if (reason.length > REASON_MAX_LENGTH) {
        reason = reason.slice(0, REASON_MAX_LENGTH);
      }
      if (reason === "") reason = undefined;
    }

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

    // Only confirmed and in-progress bookings can be cancelled. 
    // In-progress bookings can be cancelled by the user during the reservation flow.
    // Abandoned 'in progress' sessions without user action are reaped by the expired-booking scraper.
    if (booking.status !== 'confirmed' && booking.status !== 'in progress') {
      logger.error("Status check failed", {
        bookingId,
        status: booking.status,
        allowedStatuses: ["confirmed", "in progress"],
      });
      throw new Exception(
        `Booking has status "${booking.status}" and cannot be cancelled`,
        { code: 400 }
      );
    }
    logger.info("Status check passed", { status: booking.status });

    // TODO: Add cancellation window validation when policy infrastructure is implemented
    // Should check booking.reservationPolicySnapshot.temporalWindows.cancellationWindow
    // to determine if current time is within allowed cancellation period

    // For now, by default - the cancellation must occur before the booking's checkout time, if it exists.

    const queryTime = new Date().getTime();

    const checkoutTime = booking?.reservationContext?.checkoutTime;


    if (checkoutTime && queryTime > checkoutTime) {
      throw new Exception(
        `Booking cannot be cancelled after the checkout time of ${new Date(checkoutTime).toISOString()}`,
        { code: 400 }
      );
    }

    // No refund pipeline yet — flip the booking to cancelled + set isPending so
    // the expired-booking scraper returns inventory on its next run. When
    // refunds land, this is where the cancellation event will be published.
    const updateRequest = await flagCancelledBooking(booking, queryTime, reason, userId);

    // batchTransactData returns boolean true on success — we don't surface any
    // identifier from it. Just await for the side effect.
    await batchTransactData(updateRequest);

    logger.info(`Booking ${bookingId} cancelled.`);

    // Queue the cancellation email. Fire-and-forget so a Cognito/SQS hiccup
    // can't roll back a successful cancellation.
    try {
      const emailParams = await generateEmailParams(booking);
      await sendBookingCancellationEmail(emailParams, userId);
    } catch (emailError) {
      logger.error("Failed to queue cancellation email", {
        bookingId,
        error: emailError?.message,
        stack: emailError?.stack,
      });
    }

    return sendResponse(
      200,
      {
        message: "Booking cancelled",
        bookingId,
      },
      "Success",
      null,
      context
    );
  } catch (error) {
    logger.error("Error during cancellation", {
      bookingId: event?.pathParameters?.bookingId,
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      stack: error?.stack,
      cancellationReasons: error?.CancellationReasons,
    });
    
    // The flagCancelledBooking ConditionExpression rejects the second of two
    // racing cancels — surface that as a clean 400 rather than a 500.
    if (error?.name === "TransactionCanceledException") {
      const conditionFailed = (error.CancellationReasons || []).some(
        (r) => r?.Code === "ConditionalCheckFailed"
      );
      if (conditionFailed) {
        logger.error("TransactionCancelled due to ConditionalCheckFailed (racing cancel)");
        return sendResponse(
          400,
          null,
          "Booking is already cancelled",
          null,
          context
        );
      }
    }
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error cancelling booking",
      error?.error || error,
      context
    );
  }
};
