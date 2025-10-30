const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("../../../../common/data-utils");
const { ACTIVITY_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /activities/{collectionId} POST
 * Create Activities
 */
exports.handler = async (event, context) => {
  logger.info(`POST Activities: ${event}`);
  try {
    const collectionId = String(event?.pathParameters?.collectionId);
    if (!collectionId) {
      throw new Exception("collectionId is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    body['collectionId'] = collectionId;
    body['schema'] = "activity";

    // Attempt to batch create a activity.
    // If it fails, reset the counter on reserve-rec-counter table and try again.
    let postRequests;
    let success = false;
    let attempt = 1;
    const MAX_RETRIES = 3;
    while (attempt <= MAX_RETRIES && !success) {
      // Grab the activityType if provided
      const { activityType } = event?.queryStringParameters || {};
      postRequests = await parseRequest(collectionId, body, "POST", activityType);

      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        REFERENCE_DATA_TABLE,
        postRequests,
        ACTIVITY_API_PUT_CONFIG
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

    return sendResponse(200, postRequests, "Success", null, context);
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
