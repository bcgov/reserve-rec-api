const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("../../../../common/data-utils");
const { POLICY_BOOKING_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /policies/booking/ POST
 * Create Booking Policy
 */
exports.handler = async (event, context) => {
  logger.info(`POST Booking Policy: ${event}`);
  try {

    // Policies are immutable.
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    body['schema'] = 'policy';
    body['policyType'] = 'booking';

    // Attempt to batch create policies.
    // If it fails, reset the counter on reserve-rec-counter table and try again.
    let res;
    let success = false;
    let attempt = 1;
    const MAX_RETRIES = 3;
    let postRequests = {};
    while (attempt <= MAX_RETRIES && !success) {
      // Grab the facilityType if provided
      postRequests = await parseRequest( body, "POST", body?.policyType);

      // Use quickApiPutHandler to create the put items
      const putItems = await quickApiPutHandler(
        REFERENCE_DATA_TABLE_NAME,
        postRequests,
        POLICY_BOOKING_API_PUT_CONFIG
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
