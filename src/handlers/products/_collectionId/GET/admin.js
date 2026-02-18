const {
  getProductsByCollectionId,
  getProductsByActivityType,
  getProductByProductId,
} = require("../../methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("../../configs");

/**
 * @api {get} /products/{collectionId} GET
 * Fetch Products
 */
exports.handler = async (event, context) => {
  logger.info(`GET Products: ${event}`);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    if (!collectionId) {
      throw new Exception("Product Collection ID (collectionId) is required", { code: 400 });
    }

    const { activityType, activityId, productId, ...queryParams } =
      event?.queryStringParameters || {};

    // Validate that activityType and activityId are provided
    if (!activityType || !activityId) {
      throw new Exception("activityType and activityId are required query parameters", { code: 400 });
    }

    let res = null;
    let filters = {};
    let allowedFilters = ALLOWED_FILTERS;
    
    // Loop through each allowed filter to check if it's in queryParams
    allowedFilters.forEach((filter) => {
      if (queryParams[filter.name]) {
        // If the filter.name is found in queryParams, add it to the result object
        filters[filter.name] =
          queryParams[filter.name] === "true"
            ? true
            : queryParams[filter.name] === "false"
              ? false
              : queryParams[filter.name];
      }
    });

    // Get product by productId
    if (productId) {
      res = await getProductByProductId(
        collectionId, 
        activityType, 
        activityId,
        productId
      );
    }
    // Get all products for this activity
    else {
      res = await getProductsByCollectionId(
        collectionId,
        activityType,
        activityId,
        filters,
        event?.queryStringParameters || null
      );
    }

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
