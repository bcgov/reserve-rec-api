// Create new transaction
const { Exception, logger, sendResponse } = require("/opt/base");
const { completeBooking } = require("../../../methods");
const { batchTransactData } = require("/opt/dynamodb");


exports.handler = async (event, context) => {
  logger.info("POST Complete Booking:", event);

  try {
    // Get relevant data from the event
    const body = JSON.parse(event?.body);
    const bookingId = event.pathParameters?.bookingId;
    const sessionId = body.sessionId;

    if (!bookingId) {
      throw new Exception("Booking ID is required", { code: 400 });
    }

    if (!sessionId) {
      throw new Exception("Session ID is required", { code: 400 });
    }

    // Extract sub (userId) from authorizer for secure email lookup
    const sub = event.requestContext.authorizer?.userId;
    if (!sub) {
      throw new Exception("User authentication required", { code: 401 });
    }

    // Complete booking and send confirmation email (all in one operation)
    const updateRequests = await completeBooking(bookingId, sessionId, body, sub);

    const res = await batchTransactData(updateRequests);

    const response = {
      res: res,
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
