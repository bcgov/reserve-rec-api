const {
  getFacilitiesByOrcs,
  getFacilitiesByFacilityType,
  getFacilityByFacilityId,
} = require("/opt/facilities/methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/facilities/constants");

/**
 * @api {get} /facilities/{orcs} GET
 * Fetch Facilities
 */
exports.handler = async (event, context) => {
  logger.info("GET Facilities", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const orcs = event?.pathParameters?.orcs;

    if (!orcs) {
      throw new Exception("ORCS is required", { code: 400 });
    }

    const { facilityType, facilityId, ...queryParams } =
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
      res = await getFacilityByFacilityId(orcs, facilityType, facilityId);
    }

    if (facilityType && !facilityId) {
      res = await getFacilitiesByFacilityType(
        orcs,
        facilityType,
        filters,
        event?.queryStringParameters || null
      );
    }

    if (!facilityType && !facilityId) {
      res = await getFacilitiesByOrcs(
        orcs,
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
