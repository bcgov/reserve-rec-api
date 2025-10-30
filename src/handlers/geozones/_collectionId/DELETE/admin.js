const { Exception, logger, sendResponse } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {delete} /geozones/{collectionId}/{geozoneId} DELETE
 * Delete Geozones
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Geozones", event);
  try {
    const collectionId = event?.pathParameters?.collectionId;
    const geozoneId = event?.pathParameters?.geozoneId;
    const body = JSON.parse(event?.body);

    if (!collectionId || !geozoneId) {
      throw new Exception("collectionId is required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    const deleteItem = createDeleteCommand(collectionId, geozoneId)

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

function createDeleteCommand(collectionId, geozoneId) {
  return {
    action: "Delete",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({
        pk: `geozone::${collectionId}`,
        sk: `${geozoneId}`
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}

