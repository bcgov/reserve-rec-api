const {
  getFacilitiesByFcCollectionId,
  getFacilitiesByFacilityType,
  getFacilityByFacilityId,
} = require("/opt/facilities/methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/facilities/configs");

/**
 * @api {get} /facilities/{fcCollectionId} GET
 * Fetch Facilities
 */
exports.handler = async (event, context) => {
  logger.info("GET Facilities", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const fcCollectionId = event?.pathParameters?.fcCollectionId;
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.pathParameters?.facilityId || event?.queryStringParameters?.facilityId || null;

    if (!fcCollectionId) {
      throw new Exception("Facility Collection ID (fcCollectionId) is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { ...queryParams } =
      event?.queryStringParameters || {};

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

    if (facilityType && facilityId) {
      res = await getFacilityByFacilityId(fcCollectionId, facilityType, facilityId, queryParams?.fetchActivities || false);
    }

    if (facilityType && !facilityId) {
      res = await getFacilitiesByFacilityType(
        fcCollectionId,
        facilityType,
        filters,
        event?.queryStringParameters || null
      );
    }

    if (!facilityType && !facilityId) {
      res = await getFacilitiesByFcCollectionId(
        fcCollectionId,
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
