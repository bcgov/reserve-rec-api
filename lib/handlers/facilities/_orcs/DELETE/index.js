const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");
const { validateSortKey } = require("/opt/facilities/methods");

/**
 * @api {delete} /facilities/{orcs}/ DELETE
 * Delete Facilities
 */
exports.handler = async (event, context) => {
  logger.info("DELETE Facilities", event);
  try {
    const orcs = event?.pathParameters?.orcs;
    const body = JSON.parse(event?.body);

    if (!orcs) {
      throw new Exception("ORCS is required", { code: 400 });
    }

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // Grab the facilityType or facilityId
    const { facilityType, facilityId } = event?.queryStringParameters || {};

    if (!facilityType && !facilityId) {
      throw new Exception("facilityType and facilityId are required", { code: 400 });
    }
    
    const deleteItem = createDeleteCommand(orcs, facilityType, facilityId)
    
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

function createDeleteCommand(orcs, facilityType, facilityId, sk = undefined) {
  // Use sk if provided in a batch request, otherwise there won't be an sk
  // so use the pathParams to create sk
  const sortKey = sk || `${facilityType}::${facilityId}`;
  return {
    action: "Delete",
    data: {
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `facility::${orcs}`,
        sk: sortKey,
      }),
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    },
  };
}
