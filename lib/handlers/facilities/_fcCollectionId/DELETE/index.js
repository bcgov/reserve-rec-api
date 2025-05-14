const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {delete} /facilities/{fcCollectionId}/ DELETE
 * Delete Facilities
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Facilities", event);
  try {
    const fcCollectionId = event?.pathParameters?.fcCollectionId;
    const body = JSON.parse(event?.body);

    if (!fcCollectionId) {
      throw new Exception("Facility Collection Id (fcCollectionId) is required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // Grab the facilityType or facilityId
    const { facilityType, facilityId } = event?.queryStringParameters || {};

    if (!facilityType && !facilityId) {
      throw new Exception("facilityType and facilityId are required", { code: 400 });
    }

    const deleteItem = createDeleteCommand(fcCollectionId, facilityType, facilityId)

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

function createDeleteCommand(fcCollectionId, facilityType, facilityId, sk = undefined) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = sk || `${facilityType}::${facilityId}`;
  return {
    action: "Delete",
    data: {
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `facility::${fcCollectionId}`,
        sk: sortKey,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}
