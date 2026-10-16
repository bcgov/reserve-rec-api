/** 
 * Remove an item from a booking.
 */
const { requestIdentity, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { batchTransactData, isConditionFailure } = require("/opt/dynamodb");
const { BOOKING_STATUSES } = require("../../../../../common/data-constants");

const {
  cartRemovalRefusal,
  getBookingByBookingId,
  flagRemovedBooking,
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
    if (booking.status !== BOOKING_STATUSES.IN_PROGRESS) {
      logger.error("Status check failed", {
        bookingId,
        status: booking.status,
        allowedStatuses: [BOOKING_STATUSES.IN_PROGRESS],
      });
      throw refused("state", `Booking does not have the "in progress" status and cannot be removed`, 409);
    }

    logger.info("Removal: status check passed", { status: booking.status });

    // No refund pipeline yet — flip the booking to cancelled + set isPending so
    // the expired-booking scraper returns inventory on its next run.
    const removalTime = Date.now();
    const updateRequest = await flagRemovedBooking(booking, removalTime, userId);

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
    logger.error("Error during booking removal", {
      bookingId: event?.pathParameters?.bookingId,
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      stack: error?.stack,
      cancellationReasons: error?.CancellationReasons,
    });
    
    // The flagRemovedBooking ConditionExpression prevents a concurrent state
    // change from removing a booking that is no longer in progress.
    const racedRemoval = isConditionFailure(error);
    const refusal = racedRemoval ? "state" : error?.data?.refusal;
    const outcome = {
      bookingId: event?.pathParameters?.bookingId,
      code: error?.code,
      message: error?.message,
    };
    if (refusal) {
      logger.info(`event=remove_refused_${refusal}`, outcome);
    } else {
      logger.error("event=remove_failed", outcome);
    }

    if (racedRemoval) {
      return sendResponse(409, null, "Booking could not be removed because its status changed", null, context);
    }
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error removing booking",
      error?.error || error,
      context
    );
  }
};
