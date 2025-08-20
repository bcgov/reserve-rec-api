const { Exception, logger, sendResponse } = require("/opt/base");
const { getProducts } = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("GET Products", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  const acCollectionId = event?.pathParameters?.acCollectionId || null;
  const activityType = event?.pathParameters?.activityType || null;
  const activityId = event?.pathParameters?.activityId || null;
  const seasonId = event?.pathParameters?.seasonId || null;
  const productId = event?.pathParameters?.productId || null;

  const getPolicies = event?.queryStringParameters?.getPolicies || null;

  if (!acCollectionId || !activityType || !activityId) {
    throw new Exception("Activity Collection ID (acCollectionId), Activity Type and Activity ID are required", { code: 400 });
  }

  if (!seasonId && productId) {
    throw new Exception("Season ID is required when product ID is provided", { code: 400 });
  }

  const products = await getProducts(
    acCollectionId,
    activityType,
    activityId,
    seasonId,
    productId, {
      getPolicies: getPolicies
    }
  );

  try {
    return sendResponse(200, products, "Success", null, context);
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
