// Complete a booking: write the booking row, then dispatch the confirmation
// email. The email must go out only after the DynamoDB write succeeds —
// otherwise a transient DB failure would leave the user with a confirmation
// email for a booking that was never saved.
const { requestIdentity, logger, sendResponse } = require("/opt/base");
const { completeBooking, sendBookingConfirmationEmail } = require("../../../methods");
const { enqueueSmsReminderIfNeeded } = require("../../../notifications");
const { batchTransactData } = require("/opt/dynamodb");
const { refused } = require("../../../refusals");


exports.handler = async (event, context) => {
  logger.info("POST Complete Booking:", requestIdentity(event));

  // Declared out here so the catch can name the booking. Inside the try it is
  // out of scope there, and reading it throws over whatever the real error was.
  const bookingId = event.pathParameters?.bookingId;

  try {
    let body;
    try {
      body = JSON.parse(event?.body);
    } catch {
      throw refused("invalid", "Body must be valid JSON");
    }
    const sessionId = body?.sessionId;

    if (!bookingId) {
      throw refused("invalid", "Booking ID is required");
    }

    if (!sessionId) {
      throw refused("invalid", "Session ID is required");
    }

    // Custom authorizer exposes the Cognito sub flat under `userId`.
    const sub = event.requestContext?.authorizer?.userId;
    if (!sub) {
      throw refused("invalid", "User authentication required", 401);
    }

    const { updateRequests, emailParams, smsParams } = await completeBooking(bookingId, sessionId, body, { sub });

    const res = await batchTransactData(updateRequests);

    // Booking is durable — now queue the notifications. Failures here are
    // logged but do not roll back the booking; the user has a confirmed booking.
    try {
      await sendBookingConfirmationEmail(emailParams, sub);
    } catch (emailError) {
      logger.error("Booking completed but confirmation email send failed", {
        bookingId,
        error: emailError?.message,
        stack: emailError?.stack,
      });
    }

    // Confirmation SMS — the opt-in and Cognito-resolved phone are only present
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

    logger.info("event=booking_completed", { bookingId });

    return sendResponse(200, { res }, "Success", null, context);

  } catch (error) {
    const outcome = { bookingId, code: error?.code, message: error?.message };
    if (error?.data?.refusal) {
      logger.info(`event=complete_refused_${error.data.refusal}`, outcome);
    } else {
      logger.error("event=booking_complete_failed", outcome);
    }
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
