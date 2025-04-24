const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { GEOZONE_API_UPDATE_CONFIG } = require("/opt/geozones/configs");
const { parseRequest } = require("/opt/geozones/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /geozones/{gzCollectionId} PUT
 * Update Geozones
 */
exports.handler = async (event, context) => {
  logger.info("PUT Geozones", event);
  try {
    const gzCollectionId = event?.pathParameters?.gzcollectionid;
    if (!gzCollectionId) {
      throw new Exception("gzCollectionId is required", { code: 400 });
    }
    
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the geozoneId if provided
    const { geozoneId } = event?.queryStringParameters || {};
    let updateRequests = await parseRequest(gzCollectionId, body, "PUT", geozoneId);

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      TABLE_NAME,
      updateRequests,
      GEOZONE_API_UPDATE_CONFIG
    );

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

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
