const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { FACILITY_API_PUT_CONFIG } = require("/opt/facilities/configs");
const { parseRequest } = require("/opt/facilities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /facilities/{orcs} POST
 * Create Facilities
 */
exports.handler = async (event, context) => {
  logger.info("POST Facilities", event);
  try {
    const orcs = String(event?.pathParameters?.orcs);
    if (!orcs) {
      throw new Exception("ORCS is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { facilityType, facilityId } = event?.queryStringParameters || {};
    
    let postRequests = parseRequest(orcs, facilityType, facilityId, body, "POST");

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(
      TABLE_NAME,
      postRequests,
      FACILITY_API_PUT_CONFIG
    );

    // Use batchTransactData to put the database
    const res = await batchTransactData(putItems);

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
