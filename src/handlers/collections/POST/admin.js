const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { quickApiPutHandler } = require("../../../common/data-utils");
const { COLLECTION_API_PUT_CONFIG } = require("../configs");
const { parseRequest, getCollectionByCollectionId } = require("../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /collections POST
 * Create a Collection
 */
exports.handler = async (event, context) => {
  logger.info("POST Collections", event);
  try {
    const authContext = checkAuthContext(event, "superadmin");

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    if (!body.collectionId) {
      throw new Exception("collectionId is required in the request body", { code: 400 });
    }

    // Enforce collectionId uniqueness — no counter means we must check manually
    const existing = await getCollectionByCollectionId(body.collectionId);
    if (existing) {
      throw new Exception(`Collection with collectionId '${body.collectionId}' already exists`, { code: 409 });
    }

    const postRequest = await parseRequest(body, "POST");

    const putItems = await quickApiPutHandler(
      REFERENCE_DATA_TABLE_NAME,
      [postRequest],
      COLLECTION_API_PUT_CONFIG
    );

    await batchTransactData(putItems);

    return sendResponse(200, postRequest.data, "Success", null, context);
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
