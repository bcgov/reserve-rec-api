// Get transaction

const { Exception, logger, sendResponse } = require("/opt/base");

exports.handler = async (event, context) => {
  logger.info("Transactions GET:", event);

  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  try {
    // TODO: retrieve a transaction
    return sendResponse(200, {}, "Success", null, context);
  } catch (error) {
    logger.error("Error in transactions GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
