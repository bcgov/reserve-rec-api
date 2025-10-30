const { Exception, logger, sendResponse } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {delete} /activities/{collectionId}/ DELETE
 * Delete Activities
 */
exports.handler = async (event, context) => {
  logger.info(`DELETE Activities: ${event}`);
  try {
    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const body = JSON.parse(event?.body);

    if (!collectionId || !activityType || !activityId) {
      throw new Exception("Activity Collection ID, Activity Type, and Activity ID are required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    const deleteItem = createDeleteCommand(collectionId, activityType, activityId)

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

function createDeleteCommand(collectionId, activityType, activityId) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = `${activityType}::${activityId}`;
  return {
    action: "Delete",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({
        pk: `activity::${collectionId}`,
        sk: sortKey,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}
