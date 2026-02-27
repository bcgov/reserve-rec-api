const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("../../../../common/data-utils");
const { PRODUCT_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /products/{collectionId} POST
 * Create Products
 */
exports.handler = async (event, context) => {
  logger.info("POST Products", event);
  try {
    const body = JSON.parse(event?.body);
    const collectionId = String(event?.pathParameters?.collectionId);
    const activityType = event?.queryStringParameters?.activityType || event.pathParameters?.activityType || body?.activityType;
    const activityId = event?.queryStringParameters?.activityId || event.pathParameters?.activityId || body?.activityId;

    // Validate required parameters from body
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");

    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    // If body is an array, validate each item has required fields
    if (body.length > 0) {
      for (const item of body) {
        if (!item.activityType || !item.activityId) {
          throw new Error("Each item in body must include activityType and activityId");
        }
      }
    }

    // Add collection and schema
    body['collectionId'] = collectionId;
    body['schema'] = "product";

    // Attempt to batch create a product.
    // If it fails, reset the counter on reserve-rec-counter table and try again.
    let postRequests;
    let success = false;
    let attempt = 0;
    const MAX_RETRIES = 3;
    while (attempt <= MAX_RETRIES && !success) {
      // Create the productId / identifier
      postRequests = await parseRequest(collectionId, body, "POST", activityType, activityId);

      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        REFERENCE_DATA_TABLE_NAME,
        postRequests,
        PRODUCT_API_PUT_CONFIG
      );

      try {
        attempt++;
        await batchTransactData(putItems);
        success = true;
        logger.info(`Transaction succeeded on attempt ${attempt}`);
      } catch (error) {
        if (attempt >= MAX_RETRIES) {
          logger.error(`Failed after ${MAX_RETRIES} attempts.`);
          throw error;
        }

        // Short pause before attempting again
        await new Promise((r) => setTimeout(r, attempt * 100));
      }
    }

    logger.info(`Created product successfully`);

    return sendResponse(200, postRequests, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.mgs || error.message || "Error",
      error?.error || error,
      context
    );
  }
};
