const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { FACILITY_API_UPDATE_CONFIG } = require("/opt/facilities/configs");
const { parseRequest } = require("/opt/facilities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /facilities/{fcCollectionId} PUT
 * Update Facilities
 */
exports.handler = async (event, context) => {
  logger.info("PUT Facilities", event);
  try {
    const fcCollectionId = event?.pathParameters?.fccollectionid;
    const body = JSON.parse(event?.body);

    if (!fcCollectionId) {
      throw new Exception("Facility Collection Id (fcCollectionId) is required", { code: 400 });
    }

    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { facilityType, facilityId } = event?.queryStringParameters || {};

    let updateRequests = await parseRequest(fcCollectionId, body, "PUT", facilityType, facilityId);

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      TABLE_NAME,
      updateRequests,
      FACILITY_API_UPDATE_CONFIG
    );

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

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
