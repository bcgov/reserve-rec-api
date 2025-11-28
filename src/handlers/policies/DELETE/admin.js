const { logger, sendResponse } = require('/opt/base');
/**
 * @api {delete} /policies/ DELETE
 * Delete Policy (not implemented)
 */
exports.handler = async (event, context) => {
  logger.info(`DELETE Policy: ${event}`);

  try{

    return sendResponse(501, {}, "Not Implemented", null, context);

  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
}