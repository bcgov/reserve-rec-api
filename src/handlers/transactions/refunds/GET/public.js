// Get refund by refund ID

const { Exception, logger, sendResponse } = require("/opt/base");
const { getAllRefundsByTransactionId, getRefundByRefundId } = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("Refunds public GET:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // TODO: complete public endpoint for refunds later
    return sendResponse(200, {}, "Success", null, context);
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
