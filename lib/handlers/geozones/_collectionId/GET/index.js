const {
  getGeozonesByCollectionId,
  getGeozonesByGeozoneId,
} = require("../../methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("../../configs");

/**
 * @api {get} /geozones/{collectionId} GET
 * Fetch geozones
 */
exports.handler = async (event, context) => {
  logger.info("GET geozones", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    const geozoneId = event?.pathParameters?.geozoneId || event?.queryStringParameters?.geozoneId || null;

    if (!collectionId) {
      throw new Exception("collectionId is required", { code: 400 });
    }

    const queryParams = event?.queryStringParameters || {};

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

    if (geozoneId) {
      res = await getGeozonesByGeozoneId(
        collectionId,
        geozoneId,
        filters,
        event?.queryStringParameters || null
      );
    }

    if (!geozoneId) {
      res = await getGeozonesByCollectionId(
        collectionId,
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

