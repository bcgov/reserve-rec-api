const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { FACILITY_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /facilities/{collectionId} POST
 * Create Facilities
 */
exports.handler = async (event, context) => {
  logger.info("POST Facilities", event);
  try {
    const collectionId = String(event?.pathParameters?.collectionId);
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || null;
    if (!collectionId) {
      throw new Exception("Facility Collection ID (collectionId) is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    body['collectionId'] = collectionId;
    body['schema'] = 'facility';

    // Attempt to batch create a facility.
    // If it fails, reset the counter on reserve-rec-counter table and try again.
    let res;
    let success = false;
    let attempt = 1;
    const MAX_RETRIES = 3;
    let postRequests = {};
    while (attempt <= MAX_RETRIES && !success) {
      // Grab the facilityType if provided
      postRequests = await parseRequest(collectionId, body, "POST", facilityType);

      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        TABLE_NAME,
        postRequests,
        FACILITY_API_PUT_CONFIG
      );

      try {
        attempt++;
        const res = await batchTransactData(putItems);

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
