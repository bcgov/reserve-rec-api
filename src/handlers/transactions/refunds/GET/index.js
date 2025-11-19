// Get refund by refund ID

const { Exception, logger, sendResponse } = require("/opt/base");
const { getAllRefundsByTransactionId, getRefundByRefundId } = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("Refunds GET:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Get relevant data from the event
    // Search by ID
    const clientTransactionId =
      event?.pathParameters?.clientTransactionId ||
      event?.queryStringParameters?.clientTransactionId;
    
    const refundId =
      event?.pathParameters?.refundId ||
      event?.queryStringParameters?.refundId;

    if (!clientTransactionId) {
      throw new Exception("Required items are missing", { code: 400 });
    }

    let refunds = null;

    // If no refundId is provided, get all refunds for the transaction
    // otherwise, get the specific refund
    if (!refundId) {
      refunds = await getAllRefundsByTransactionId(
        clientTransactionId,
        refundId
      );
    } else {
      refunds = await getRefundByRefundId(
        clientTransactionId,
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
