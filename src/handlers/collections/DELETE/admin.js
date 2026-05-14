const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData, getOne } = require("/opt/dynamodb");

/**
 * @api {delete} /collections/{collectionId} DELETE
 * Delete a Collection
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Collections", event);
  try {
    const authContext = checkAuthContext(event, "superadmin");

    const collectionId = event?.pathParameters?.collectionId;
    if (!collectionId) {
      throw new Exception("collectionId path parameter is required", { code: 400 });
    }

    const body = event?.body ? JSON.parse(event.body) : null;
    if (body) {
      throw new Exception("Body is not allowed on DELETE requests", { code: 400 });
    }

    const pk = "collection";
    const sk = collectionId;

    const collection = await getOne(pk, sk);
    if (!collection) {
      throw new Exception("Collection not found", { code: 404 });
    }

    const deleteItem = {
      action: "Delete",
      data: {
        TableName: REFERENCE_DATA_TABLE_NAME,
        Key: {
          pk: { S: pk },
          sk: { S: sk },
        },
      },
    };

    await batchTransactData([deleteItem]);

    return sendResponse(200, { collectionId }, "Collection deleted successfully", null, context);
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
