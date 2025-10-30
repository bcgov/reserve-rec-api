const { Exception, logger, sendResponse } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

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

    const deleteItem = createDeleteCommand(collectionId, facilityType, facilityId)

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

function createDeleteCommand(collectionId, facilityType, facilityId, sk = undefined) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = sk || `${facilityType}::${facilityId}`;
  return {
    action: "Delete",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({
        pk: `facility::${collectionId}`,
        sk: sortKey,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}
