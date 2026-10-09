/** 
 * Remove an item from a booking.
 */
const { requestIdentity, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { batchTransactData, isConditionFailure } = require("/opt/dynamodb");
const {
  cartRemovalRefusal,
  getBookingByBookingId,
  flagCancelledBooking,
  deleteBookingHoldMarker
} = require("../../../methods");
const { refused } = require("../../../refusals");

exports.handler = async (event, context) => {
  logger.info("Bookings Remove Item POST:", requestIdentity(event));

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Get booking ID from path parameters
    const bookingId = event?.pathParameters?.bookingId;
    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!userId) {
      throw refused("invalid", "Unauthorized: User ID not found in request claims", 401);
    }

    if (!bookingId) {
      throw refused("invalid", "Booking ID required in request");
    }

    const booking = await getBookingByBookingId(bookingId);

    // Verify ownership
    if (booking.userId !== userId) {
      throw refused("owner", `User ${userId} does not own booking ${bookingId}`, 403);
    }

    // Only in-progress bookings can be removed. 
    // In-progress bookings can be removed by the user during the reservation flow.
    // Abandoned 'in progress' sessions without user action are reaped by the expired-booking scraper.
    if (booking.status !== 'in progress') {
      logger.error("Status check failed", {
        bookingId,
        status: booking.status,
        allowedStatuses: ["in progress"],
      });
      throw refused("state", `Booking has status "${booking.status}" and cannot be removed`, 409);
    }

    logger.info("Removal: status check passed", { status: booking.status });

    // No refund pipeline yet — flip the booking to cancelled + set isPending so
    // the expired-booking scraper returns inventory on its next run.
    const removalTime = Date.now();
    const updateRequest = await flagCancelledBooking(booking, removalTime, undefined, userId, { requireInProgress: true });

    // batchTransactData returns boolean true on success — we don't surface any
    // identifier from it. Just await for the side effect.
    try {
      await batchTransactData(updateRequest);
    } catch (writeError) {
      if (!isConditionFailure(writeError)) throw writeError;
      const current = await getBookingByBookingId(bookingId);
      if (current?.status === "in progress") throw writeError;
      throw cartRemovalRefusal(current?.status);
    }

    logger.info(`Booking ${bookingId} removed from cart.`);

    // Release the per-user/product/date hold marker so the user can immediately
    // re-book this slot. Best-effort: a leftover marker only blocks re-booking
    // until the expiry scraper reaps it, so never fail the cancel over it.
    try {
      await batchTransactData([deleteBookingHoldMarker(booking)]);
    } catch (markerError) {
      logger.warn("Failed to delete booking-hold marker on cancel", {
        bookingId,
        error: markerError?.message,
      });
    }

    return sendResponse(
      200,
      {
        message: "Booking removed",
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
    const racedCancel = isConditionFailure(error);
    const refusal = racedCancel ? "state" : error?.data?.refusal;
    const outcome = {
      bookingId: event?.pathParameters?.bookingId,
      code: error?.code,
      message: error?.message,
    };
    if (refusal) {
      logger.info(`event=cancel_refused_${refusal}`, outcome);
    } else {
      logger.error("event=cancel_failed", outcome);
    }

    if (racedCancel) {
      return sendResponse(400, null, "Booking is already cancelled", null, context);
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
