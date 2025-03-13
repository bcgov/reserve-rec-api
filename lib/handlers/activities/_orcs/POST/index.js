const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { ACTIVITY_API_PUT_CONFIG } = require("/opt/activities/configs");
const { validateSortKey } = require("/opt/activities/methods");
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

    // Grab the activityType or activityId if provided
    const { activityType, activityId } = event?.queryStringParameters || {};
    let postRequests = [];
    // Process batch request or a single request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        postRequests.push(processItem(orcs, activityType, activityId, sk, item));
      }
    } else {
      const { sk } = body;
      postRequests.push(processItem(orcs, activityType, activityId, sk, body));
    }

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

function processItem(orcs, activityType, activityId, sk, item) {
  validateSortKey(activityType, activityId, sk)
  return createPostCommand(orcs, activityType, activityId, sk, item);
}

function createPostCommand(orcs, activityType, activityId, sk, item) {
  const pk = `activity::${orcs}`;
  sk = sk ? sk : `${activityType}::${activityId}`;

  item.pk = pk;
  item.sk = sk

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}
