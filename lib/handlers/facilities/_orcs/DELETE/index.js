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

    // Grab the facilityType or facilityId if provided
    const { facilityType, facilityId } = event?.queryStringParameters || {};
    const deleteItems = [];
    // Check if request is a batch request or a single request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        deleteItems.push(processItem(orcs, facilityType, facilityId, sk, item))
      }
    } else {
      deleteItems.push(createDeleteCommand(orcs, facilityType, facilityId))
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

function processItem(orcs, facilityType, facilityId, sk, item) {
  validateSortKey(facilityType, facilityId, sk);
  return createDeleteCommand(orcs, facilityType, facilityId, sk);
}

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
