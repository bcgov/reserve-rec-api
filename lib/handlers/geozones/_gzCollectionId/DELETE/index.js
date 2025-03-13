const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");
const { validateSortKey } = require("/opt/geozones/methods");

/**
 * @api {delete} /geozones/{gzCollectionId}/ DELETE
 * Delete Geozones
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Geozones", event);
  try {
    const gzCollectionId = event?.pathParameters?.gzcollectionid;
    const body = JSON.parse(event?.body);

    if (!gzCollectionId) {
      throw new Exception("gzCollectionId is required", { code: 400 });
    }

    const { geozoneId } = event?.queryStringParameters || {};
    const deleteItems = [];

    // Check if request is a batch request or a single request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        deleteItems.push(processItem(gzCollectionId, geozoneId, sk, item))
      }
    } else {
      deleteItems.push(createDeleteCommand(gzCollectionId, geozoneId))
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

function processItem(gzCollectionId, geozoneId, sk) {
  validateSortKey(geozoneId, sk);
  return createDeleteCommand(gzCollectionId, geozoneId, sk);
}

function createDeleteCommand(gzCollectionId, geozoneId, sk = undefined) {
  const sortKey = sk || `${geozoneId}`;
  return {
    action: "Delete",
    data: {
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `geozone::${gzCollectionId}`,
        sk: sortKey,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}

