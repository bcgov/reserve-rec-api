const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("../../../../common/data-utils");
const { GEOZONE_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /geozones/{collectionId} POST
 * Create Geozones
 */
exports.handler = async (event, context) => {
  logger.info("POST Geozones", event);
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
    body['schema'] = 'geozone';

    // Attempt to batch create a geozone.
    // If it fails, reset the counter on reserve-rec-counter table and try again.
    let postRequests;
    let success = false;
    let attempt = 0;
    const MAX_RETRIES = 3;
    while (attempt <= MAX_RETRIES && !success) {
      // Create the geozoneId / identifier
      postRequests = await parseRequest(collectionId, body, "POST");


      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        REFERENCE_DATA_TABLE_NAME,
        postRequests,
        GEOZONE_API_PUT_CONFIG
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
