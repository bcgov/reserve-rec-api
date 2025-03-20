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

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // Grab the activityType or activityId
    const { activityType, activityId } = event?.queryStringParameters || {};

    if (!activityType && !activityId) {
      throw new Exception("activityType and activityId are required", { code: 400 });
    }
    
    const deleteItem = createDeleteCommand(orcs, activityType, activityId)
    
    // Use batchTransactData to delete the database item
    const res = await batchTransactData([deleteItem]);
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

function createDeleteCommand(orcs, activityType, activityId) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = `${activityType}::${activityId}`;
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
