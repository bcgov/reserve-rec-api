const { Exception, logger, sendResponse } = require("/opt/base");

exports.handler = async (event, context) => {
  logger.info("Refund public POST:", event);

  try {
    // TODO: complete public endpoint for refunds later
    return sendResponse(200, {}, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error processing refund",
      error?.error || error,
      context
    );
  }
};
