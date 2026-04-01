const { fetchProducts } = require("../../methods");
const { logger, sendResponse, checkAuthContext } = require("/opt/base");

/**
 * @api {get} /products/{collectionId} GET
 * Fetch Products Admin
 */
exports.handler = async (event, context) => {
  logger.info(`GET Products Admin: ${event}`);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  const collectionId = event?.pathParameters?.collectionId;
  const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || null;
  const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || null;
  const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId || null;
  const { ...queryParams } = event?.queryStringParameters || {};

  try {
    const authContext = checkAuthContext(event);

    const res = await fetchProducts(collectionId, activityType, activityId, productId, queryParams, authContext)

    return sendResponse(200, res, "Success", null, context);
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
