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
    if (!acCollectionId) {
      throw new Exception("Activity Collection ID (acCollectionId) is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    const { activityType, activityId } = event?.queryStringParameters || {};
    let updateRequests = parseRequest(acCollectionId, activityType, activityId, body, "PUT");

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

function processItem(acCollectionId, activityType, activityId, sk, item) {
  validateSortKey(activityType, activityId, sk);
  return createPutCommand(acCollectionId, activityType, activityId, sk, item);
}

function createPutCommand(acCollectionId, activityType, activityId, sk, item) {
  const pk = `activity::${acCollectionId}`;
  sk = sk ? sk : `${activityType}::${activityId}`;

  // Remove pk, sk, activityType, and activityId as these can't be updated
  delete item.pk;
  delete item.sk;
  delete item.activityType;
  delete item.activityId;

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}

