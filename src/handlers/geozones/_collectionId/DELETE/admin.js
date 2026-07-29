const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData, getOne } = require("/opt/dynamodb");
const { deleteEntityRelationships } = require("../../../../common/relationship-utils.js");

/**
 * @api {delete} /geozones/{collectionId}/{geozoneId} DELETE
 * Delete Geozones
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Geozones", event);
  try {
    const authContext = checkAuthContext(event, "superadmin");

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

    // Now soft-delete the geozone itself (keep the row, mark it deleted so it's hidden)
    const user = event?.requestContext?.authorizer?.principalId || "system";
    const deleteItem = createSoftDeleteCommand(pk, sk, user);
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

function createSoftDeleteCommand(pk, sk, user) {
  return {
    action: "Update",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({ pk, sk }),
      UpdateExpression: "SET isDeleted = :true, deletedAt = :deletedAt, deletedBy = :deletedBy",
      ExpressionAttributeValues: marshall({
        ":true": true,
        ":deletedAt": new Date().toISOString(),
        ":deletedBy": user,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}

