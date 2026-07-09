const { Exception, logger, sendResponse } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");
const { deleteEntityRelationships } = require("../../../../common/relationship-utils");

/**
 * @api {delete} /facilities/{collectionId}/ DELETE
 * Delete Facilities
 */
exports.handler = async (event, context) => {
  logger.info(`DELETE Facilities: ${event}`);
  try {
    const collectionId = event?.pathParameters?.collectionId;
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType;
    const facilityId = event?.pathParameters?.facilityId || event?.queryStringParameters?.facilityId;
    const body = JSON.parse(event?.body);

    if (!collectionId || !facilityType || !facilityId) {
      throw new Exception("Facility Collection ID, Facility Type, and Facility ID are required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // First, delete all relationships associated with this facility
    const pk = `facility::${collectionId}`;
    const sk = `${facilityType}::${facilityId}`;
    
    logger.info(`Deleting relationships for: rel::${pk}::${sk}`);
    const relationshipResult = await deleteEntityRelationships(pk, sk);
    logger.info(`Deleted ${relationshipResult.deletedCount} relationships`);

    // Then soft-delete the facility itself (keep the row, mark it deleted so it's hidden)
    const user = event?.requestContext?.authorizer?.principalId || "system";
    const deleteItem = createSoftDeleteCommand(collectionId, facilityType, facilityId, user);

    const res = await batchTransactData([deleteItem]);
    
    return sendResponse(200, {
      ...res,
      relationshipsDeleted: relationshipResult.deletedCount
    }, "Success", null, context);
  } catch (error) {
    logger.error('Error deleting facility:', error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error deleting facility",
      null,
      context
    );
  }
};

function createSoftDeleteCommand(collectionId, facilityType, facilityId, user, sk = undefined) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = sk || `${facilityType}::${facilityId}`;
  return {
    action: "Update",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({
        pk: `facility::${collectionId}`,
        sk: sortKey,
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
