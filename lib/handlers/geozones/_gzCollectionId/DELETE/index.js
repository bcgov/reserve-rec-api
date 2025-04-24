const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {delete} /geozones/{gzCollectionId}/ DELETE
 * Delete Geozones
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Geozones", event);
  try {
    const gzCollectionId = event?.pathParameters?.gzCollectionId;
    if (!gzCollectionId) {
      throw new Exception("gzCollectionId is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    const { geozoneId } = event?.queryStringParameters || {};
    if (!geozoneId) {
      throw new Exception("geozoneId is required", { code: 400 });
    }

    const deleteItem = createDeleteCommand(gzCollectionId, geozoneId)

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

function createDeleteCommand(gzCollectionId, geozoneId) {
  return {
    action: "Delete",
    data: {
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `geozone::${gzCollectionId}`,
        sk: `${geozoneId}`
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}

