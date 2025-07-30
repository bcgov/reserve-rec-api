const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { ACTIVITY_API_UPDATE_CONFIG } = require("/opt/activities/configs");
const { parseRequest } = require("/opt/activities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /activities/{acCollectionId} PUT
 * Update Activities
 */
exports.handler = async (event, context) => {
  logger.info("PUT Activities", event);
  try {
    const acCollectionId = event?.pathParameters?.acCollectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters || {};
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId;

    if (!acCollectionId && !activityType && !activityId) {
      throw new Exception("Activity Collection ID, Activity Type, and Activity ID are required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    let updateRequests = await parseRequest(acCollectionId, body, "PUT", activityType, activityId);

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      TABLE_NAME,
      updateRequests,
      ACTIVITY_API_UPDATE_CONFIG
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

