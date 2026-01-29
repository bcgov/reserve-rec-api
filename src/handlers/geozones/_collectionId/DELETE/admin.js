const { Exception, logger, sendResponse } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData, getOne } = require("/opt/dynamodb");
const { deleteEntityRelationships } = require("../../../../common/relationship-utils.js");

/**
 * @api {delete} /geozones/{collectionId}/{geozoneId} DELETE
 * Delete Geozones
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Geozones", event);
  try {
    const collectionId = event?.pathParameters?.collectionId;
    const geozoneId = event?.pathParameters?.geozoneId;
    const body = event?.body ? JSON.parse(event.body) : null;

    if (!collectionId || !geozoneId) {
      throw new Exception("collectionId and geozoneId are required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // Get the geozone to verify it exists and get its keys
    const pk = `geozone::${collectionId}`;
    const sk = `${geozoneId}`;
    
    const geozone = await getOne(pk, sk);
    
    if (!geozone) {
      throw new Exception("Geozone not found", { code: 404 });
    }

    // Delete all relationships first (both forward and reverse)
    const relCount = await deleteEntityRelationships(pk, sk);
    
    logger.info(`Deleted ${relCount.deletedCount} relationship(s) for geozone ${pk}::${sk}`);

    // Now delete the geozone itself
    const deleteItem = createDeleteCommand(pk, sk);
    const res = await batchTransactData([deleteItem]);
    
    return sendResponse(200, { ...res, relationshipsDeleted: relCount.deletedCount }, "Success", null, context);
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

function createDeleteCommand(pk, sk) {
  return {
    action: "Delete",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({ pk, sk }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}

