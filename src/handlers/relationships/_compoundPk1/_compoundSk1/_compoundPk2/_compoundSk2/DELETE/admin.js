const { logger, sendResponse } = require("/opt/base");
const { marshall, REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * DELETE /relationships/{pk1}/{sk1}/{pk2}/{sk2}
 *
 * Deletes a relationship between two entities
 *
 * @param pk1 - Full partition key of first entity (e.g., 'activity::bcparks_250')
 * @param sk1 - Sort key of first entity (e.g., 'dayUse::1')
 * @param pk2 - Full partition key of second entity (e.g., 'facility::bcparks_250')
 * @param sk2 - Sort key of second entity (e.g., 'campground::camping')
 *
 */
exports.handler = async (event, context) => {
  logger.info("DELETE relationship", event);
  try {
    const pk1 = event?.pathParameters?.pk1;
    const sk1 = event?.pathParameters?.sk1;
    const pk2 = event?.pathParameters?.pk2;
    const sk2 = event?.pathParameters?.sk2;
    const body = event?.body ? JSON.parse(event.body) : null;

    // Validate required parameters
    const missingParams = [];
    if (!pk1) missingParams.push("pk1");
    if (!sk1) missingParams.push("sk1");
    if (!pk2) missingParams.push("pk2");
    if (!sk2) missingParams.push("sk2");

    if (missingParams.length > 0) {
      throw new Exception(
        `Cannot delete relationship - missing required parameter(s): ${missingParams.join(
          ", "
        )}`,
        { code: 400 }
      );
    }

    // Construct the full pk and sk using the full entity keys
    const pk = `rel::${pk1}::${sk1}`;
    const sk = `${pk2}::${sk2}`;

    if (body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    const deleteItem = createDeleteCommand(pk, sk);

    // Use batchTransactData to delete the database item
    const res = await batchTransactData([deleteItem]);
    return sendResponse(200, { deleted: true, pk, sk }, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      null,
      error?.message || "Error deleting relationship",
      context
    );
  }
};

function createDeleteCommand(pk, sk) {
  return {
    action: "Delete",
    data: {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: marshall({
        pk,
        sk,
      }),
    },
  };
}
