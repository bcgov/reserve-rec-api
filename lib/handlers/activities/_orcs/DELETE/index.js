const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");
const { validateSortKey } = require("/opt/activities/methods");

/**
 * @api {delete} /activities/{orcs}/ DELETE
 * Delete Activities
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Activities", event);
  try {
    const orcs = event?.pathParameters?.orcs;
    const body = JSON.parse(event?.body);

    if (!orcs) {
      throw new Exception("orcs is required", { code: 400 });
    }

    const { activityType, activityId } = event?.queryStringParameters || {};
    const deleteItems = [];
    // Check if request is a batch request or a single request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        deleteItems.push(processItem(orcs, activityType, activityId, sk))
      }
    } else {
      deleteItems.push(createDeleteCommand(orcs, activityType, activityId))
    }

    // Use batchTransactData to put the database
    const res = await batchTransactData(deleteItems);
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
  validateSortKey(activityType, activityId, sk);
  return createDeleteCommand(orcs, activityType, activityId, sk);
}

function createDeleteCommand(orcs, activityType, activityId, sk = undefined) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = sk || `${activityType}::${activityId}`;
  return {
    action: "Delete",
    data: {
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `activity::${orcs}`,
        sk: sortKey,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}
