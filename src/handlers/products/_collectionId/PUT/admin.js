const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("../../../../common/data-utils");
const { PRODUCT_API_UPDATE_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /products/{collectionId} PUT
 * Update Products
 */
exports.handler = async (event, context) => {
  logger.info("PUT Products", event);
  try {
    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId;
    const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId || null;
    const body = JSON.parse(event?.body);

    // Validate required parameters
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");
    
    if (missingParams.length > 0) {
      throw new Exception(
        `Cannot create booking - missing required parameter(s): ${missingParams.join(", ")}`,
        { code: 400 }
      );
    }

    let updateRequests = await parseRequest(collectionId, body, "PUT", activityType, activityId, productId);

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      REFERENCE_DATA_TABLE_NAME,
      updateRequests,
      PRODUCT_API_UPDATE_CONFIG
    );

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    return sendResponse(200, updateRequests, "Success", null, context);
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
