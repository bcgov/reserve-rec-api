const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");
const { deleteEntityRelationships } = require("../../../../common/relationship-utils");

/**
 * @api {delete} /products/{collectionId}/ DELETE
 * Delete Products
 */
exports.handler = async (event, context) => {
  logger.info(`DELETE Products: ${event}`);
  try {
    const authContext = checkAuthContext(event, "superadmin");

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId;
    const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId;
    const body = JSON.parse(event?.body);

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Facility Collection ID, Facility Type, and Facility ID are required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // First, delete all relationships associated with this product
    const pk = `product::${collectionId}::${activityType}::${activityId}`;
    const sk = `${productId}`;

    logger.info(`Deleting relationships for: rel::${pk}::${sk}`);
    const relationshipResult = await deleteEntityRelationships(pk, sk);
    logger.info(`Deleted ${relationshipResult.deletedCount} relationships`);

    // Then soft-delete the product itself (keep the row, mark it deleted so it's hidden)
    const user = authContext?.sub || "system";
    const deleteItem = createSoftDeleteCommand(collectionId, activityType, activityId, productId, user);

    const res = await batchTransactData([deleteItem]);

    return sendResponse(200, {
      ...res,
      relationshipsDeleted: relationshipResult.deletedCount
    }, "Success", null, context);
  } catch (error) {
    logger.error('Error deleting product:', error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error deleting product",
      null,
      context
    );
  }
};

function createSoftDeleteCommand(collectionId, activityType, activityId, productId, user) {
  return {
    action: "Update",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({
        pk: `product::${collectionId}::${activityType}::${activityId}`,
        sk: `${productId}`,
      }),
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
