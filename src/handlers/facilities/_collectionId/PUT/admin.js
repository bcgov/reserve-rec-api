const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("../../../../common/data-utils");
const { FACILITY_API_UPDATE_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /facilities/{collectionId} PUT
 * Update Facilities
 */
exports.handler = async (event, context) => {
  logger.info(`PUT Facilities: ${event}`);
  try {
    const collectionId = event?.pathParameters?.collectionId;
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.pathParameters?.facilityId || event?.queryStringParameters?.facilityId || null;
    const body = JSON.parse(event?.body);

    if (!collectionId) {
      throw new Exception("Facility Collection Id (collectionId) is required", { code: 400 });
    }

    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    let updateRequests = await parseRequest(collectionId, body, "PUT", facilityType, facilityId);

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      REFERENCE_DATA_TABLE_NAME,
      updateRequests,
      FACILITY_API_UPDATE_CONFIG
    );

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    return sendResponse(200, updateRequests, "Success", null, context);
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
