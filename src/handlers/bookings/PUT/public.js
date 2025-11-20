// Create new transaction
const { Exception, logger, sendResponse } = require("/opt/base");
const { completeBooking } = require("../methods")
const { BOOKING_UPDATE_CONFIG } = require("../configs");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("Bookings PUT:", event);

  try {
    // Get relevant data from the event
    const body = JSON.parse(event?.body);
    const bookingId = body.bookingId;
    const sessionId = body.sessionId;

    if (!bookingId) {
      throw new Exception("Booking ID is required", { code: 400 });
    }

    if (!sessionId) {
      throw new Exception("Session ID is required", { code: 400 });
    }
    
    const updateRequests = await completeBooking(bookingId, sessionId);

    const putItems = await quickApiUpdateHandler(
      TABLE_NAME,
      [updateRequests],
      BOOKING_UPDATE_CONFIG
    );

    const res = await batchTransactData(putItems);

    const response = {
      res: res,
      booking: updateRequests,
    }

    return sendResponse(200, response, "Success", null, context);

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
