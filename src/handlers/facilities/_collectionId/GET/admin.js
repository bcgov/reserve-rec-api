const {
  getFacilitiesByCollectionId,
  getFacilitiesByFacilityType,
  getFacilityByFacilityId,
} = require("../../methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("../../configs");

/**
 * @api {get} /facilities/{collectionId} GET
 * Fetch Facilities
 */
exports.handler = async (event, context) => {
  logger.info(`GET Facilities: ${event}`);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.pathParameters?.facilityId || event?.queryStringParameters?.facilityId || null;

    if (!collectionId) {
      throw new Exception("Facility Collection ID (collectionId) is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { ...queryParams } =
      event?.queryStringParameters || {};

    let filters = {};
    let res = null;
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

    if (facilityType && facilityId) {
      res = await getFacilityByFacilityId(collectionId, facilityType, facilityId, queryParams?.fetchActivities || false);
    }

    if (facilityType && !facilityId) {
      res = await getFacilitiesByFacilityType(
        collectionId,
        facilityType,
        filters,
        event?.queryStringParameters || null
      );
    }

    if (!facilityType && !facilityId) {
      res = await getFacilitiesByCollectionId(
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
