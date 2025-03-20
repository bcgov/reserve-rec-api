const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { ACTIVITY_API_PUT_CONFIG } = require("/opt/activities/configs");
const { parseRequest } = require("/opt/activities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /activities/{orcs} POST
 * Create Activities
 */
exports.handler = async (event, context) => {
  logger.info("POST Activities", event);
  try {
    const orcs = String(event?.pathParameters?.orcs);
    if (!orcs) {
      throw new Exception("Orcs is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    const { activityType, activityId } = event?.queryStringParameters || {};
    let postRequests = parseRequest(orcs, activityType, activityId, body, "POST");

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(
      TABLE_NAME,
      postRequests,
      ACTIVITY_API_PUT_CONFIG
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
