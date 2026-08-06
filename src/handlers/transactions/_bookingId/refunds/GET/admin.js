// Get refund by refund ID

const { Exception, logger, sendResponse, handleCORS } = require("/opt/base");
const { getAllRefundsByBookingId, getRefundByRefundId } = require("../../../methods");

exports.handler = async (event, context) => {
  logger.info("Refunds admin GET:", event);

  // Handle CORS preflight
  const corsResponse = handleCORS(event, context);
  if (corsResponse) return corsResponse;

  try {
    // Get relevant data from the event
    // Search by ID
    const bookingId =
      event?.pathParameters?.bookingId ||
      event?.queryStringParameters?.bookingId;
    
    const refundId =
      event?.pathParameters?.refundId ||
      event?.queryStringParameters?.refundId;

    if (!bookingId) {
      throw new Exception("Required items are missing", { code: 400 });
    }

    let refunds = null;

    // If no refundId is provided, get all refunds for the transaction
    // otherwise, get the specific refund
    if (!refundId) {
      refunds = await getAllRefundsByBookingId(
        bookingId
      );
    } else {
      refunds = await getRefundByRefundId(
        bookingId,
        refundId
      );
    }

    return sendResponse(200, refunds, "Success", null, context);
  } catch (error) {
    logger.error("Error in refunds GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
