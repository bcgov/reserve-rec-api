// Complete a booking via PUT: write the booking row first, then dispatch the
// confirmation email. Email send must follow a successful DynamoDB write —
// otherwise a transient DB failure would leave the user with a confirmation
// email for a booking that was never saved.
const { Exception, logger, sendResponse } = require("/opt/base");
const { completeBooking, sendBookingConfirmationEmail } = require("../methods");
const { enqueueSmsReminderIfNeeded } = require("../notifications");
const { batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("Bookings PUT:", event);

  try {
    const body = JSON.parse(event?.body);
    const bookingId = event.pathParameters?.bookingId || body.bookingId;
    const sessionId = body.sessionId;

    if (!bookingId) {
      throw new Exception("Booking ID is required", { code: 400 });
    }

    if (!sessionId) {
      throw new Exception("Session ID is required", { code: 400 });
    }

    // Custom authorizer exposes the Cognito sub flat under `userId`.
    const sub = event.requestContext?.authorizer?.userId;
    if (!sub) {
      throw new Exception("User authentication required", { code: 401 });
    }

    const { updateRequests, emailParams, smsParams } = await completeBooking(bookingId, sessionId, body, { sub });

    const res = await batchTransactData(updateRequests);

    try {
      await sendBookingConfirmationEmail(emailParams, sub);
    } catch (emailError) {
      logger.error("Booking completed but confirmation email send failed", {
        bookingId,
        error: emailError?.message,
        stack: emailError?.stack,
      });
    }

    // Confirmation SMS — opt-in and Cognito-resolved phone are only present
    // once the booking is completed, so this is the correct dispatch point.
    try {
      await enqueueSmsReminderIfNeeded(
        smsParams,
        { bookingId },
        smsParams?.namedOccupant?.contactInfo?.mobilePhone
      );
    } catch (smsError) {
      logger.error("Booking completed but confirmation SMS enqueue failed", {
        bookingId,
        error: smsError?.message,
        stack: smsError?.stack,
      });
    }

    return sendResponse(200, { res, booking: updateRequests }, "Success", null, context);

  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
