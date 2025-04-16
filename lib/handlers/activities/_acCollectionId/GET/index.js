const {
  getActivitiesByAcCollectionId,
  getActivitiesByActivityType,
  getActivityByActivityId,
} = require("/opt/activities/methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/activities/configs");

/**
 * @api {get} /activities/{acCollectionId} GET
 * Fetch Activities
 */
exports.handler = async (event, context) => {
  logger.info("GET Activities", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const acCollectionId = event?.pathParameters?.acCollectionId;
    if (!acCollectionId) {
      throw new Exception("Activity Collection ID (acCollectionId) is required", { code: 400 });
    }

    const { activityType, activityId, ...queryParams } =
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

    if (activityType && activityId) {
      res = await getActivityByActivityId(acCollectionId, activityType, activityId);
    }

    if (activityType && !activityId) {
      res = await getActivitiesByActivityType(
        acCollectionId,
        activityType,
        filters,
        event?.queryStringParameters || null
      );
    }

    if (!activityType && !activityId) {
      res = await getActivitiesByAcCollectionId(
        acCollectionId,
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


