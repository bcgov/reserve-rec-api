const { logger, sendResponse } = require("/opt/base");
const { fetchFacilities } = require("../../methods");

/**
 * @api {get} /facilities/{collectionId} GET
 * Fetch Facilities Public
 */
exports.handler = async (event, context) => {
  logger.info(`GET Facilities Public: ${event}`);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  const collectionId = event?.pathParameters?.collectionId;
  const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || null;
  const facilityId = event?.pathParameters?.facilityId || event?.queryStringParameters?.facilityId || null;
  const { ...queryParams } = event?.queryStringParameters || {};

  try {
    const res = await fetchFacilities(collectionId, facilityType, facilityId, queryParams);

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
