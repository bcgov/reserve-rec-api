const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { ACTIVITY_API_PUT_CONFIG } = require("/opt/activities/configs");
const { parseRequest } = require("/opt/activities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /activities/{acCollectionId} POST
 * Create Activities
 */
exports.handler = async (event, context) => {
  logger.info("POST Activities", event);
  try {
    const acCollectionId = String(event?.pathParameters?.acCollectionId);
    if (!acCollectionId) {
      throw new Exception("acCollectionId is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    body['acCollectionId'] = acCollectionId;
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
      postRequests = await parseRequest(acCollectionId, body, "POST", activityType);
      
      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        TABLE_NAME,
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
