const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { GEOZONE_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /geozones/{gzCollectionId} POST
 * Create Geozones
 */
exports.handler = async (event, context) => {
  logger.info("POST Geozones", event);
  try {
    const gzCollectionId = String(event?.pathParameters?.gzCollectionId);

    if (!gzCollectionId) {
      throw new Exception("gzCollectionId is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    body['gzCollectionId'] = gzCollectionId;
    body['schema'] = 'geozone';

    // Attempt to batch create a geozone.
    // If it fails, reset the counter on reserve-rec-counter table and try again.
    let postRequests;
    let success = false;
    let attempt = 1;
    const MAX_RETRIES = 3;
    while (attempt <= MAX_RETRIES && !success) {
      // Create the geozoneId / identifier
      postRequests = await parseRequest(gzCollectionId, body, "POST");


      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        TABLE_NAME,
        postRequests,
        GEOZONE_API_PUT_CONFIG
      );

      try {
        attempt++;
        res = await batchTransactData(putItems);

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
