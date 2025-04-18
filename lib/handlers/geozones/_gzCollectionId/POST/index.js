const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { GEOZONE_API_PUT_CONFIG } = require("/opt/geozones/configs");
const { parseRequest } = require("/opt/geozones/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /geozones/{gzCollectionId} POST
 * Create Geozones
 */
exports.handler = async (event, context) => {
  logger.info("POST Geozones", event);
  try {
    const gzCollectionId = String(event?.pathParameters?.gzcollectionid);

    if (!gzCollectionId) {
      throw new Exception("gzCollectionId is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the geozoneId if provided
    const { geozoneId } = event?.queryStringParameters || {};
    let postRequests = parseRequest(gzCollectionId, geozoneId, body, "POST");

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(
      TABLE_NAME,
      postRequests,
      GEOZONE_API_PUT_CONFIG
    );

    // Use batchTransactData to put the database
    const res = await batchTransactData(putItems);

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
