const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { quickApiUpdateHandler } = require("../../../common/data-utils");
const { COLLECTION_API_UPDATE_CONFIG } = require("../configs");
const { parseRequest, getCollectionByCollectionId } = require("../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /collections/{collectionId} PUT
 * Update a Collection
 */
exports.handler = async (event, context) => {
  logger.info("PUT Collections", event);
  try {
    const authContext = checkAuthContext(event, "superadmin");

    const collectionId = event?.pathParameters?.collectionId;
    if (!collectionId) {
      throw new Exception("collectionId path parameter is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Verify the collection exists before updating
    const existing = await getCollectionByCollectionId(collectionId);
    if (!existing) {
      throw new Exception("Collection not found", { code: 404 });
    }

    const updateRequest = await parseRequest(body, "PUT", collectionId);

    const updateItems = await quickApiUpdateHandler(
      REFERENCE_DATA_TABLE_NAME,
      [updateRequest],
      COLLECTION_API_UPDATE_CONFIG
    );

    await batchTransactData(updateItems);

    return sendResponse(200, updateRequest.data, "Success", null, context);
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
