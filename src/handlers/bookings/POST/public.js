// Create new booking
const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { createBooking } = require("../methods");
const { BOOKING_PUT_CONFIG } = require("../configs");
const { quickApiPutHandler } = require("/opt/data-utils");
const { TRANSACTIONAL_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("Bookings POST:", event);

  try {
    // Get relevant data from the event

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId || body?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || body?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || body?.activityId;
    const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate || body?.startDate;

    const claims = getRequestClaimsFromEvent(event);
    body['userId'] = claims?.sub || null;


    if (!collectionId || !activityType || !activityId || !startDate || !body.user) {
      throw new Exception("Activity Collection ID (collectionId), Activity Type (activityType), Activity ID (activityId) and Start Date (startDate) are required", { code: 400 });
    }

    let postRequests = await createBooking(collectionId, activityType, activityId, startDate, body);

    const putItems = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      postRequests,
      BOOKING_PUT_CONFIG
    );

    const res = await batchTransactData(putItems);

    const response = {
      res: res,
      booking: postRequests,
    }

    return sendResponse(200, response, "Success", null, context);

  } catch (error) {
    logger.error("Booking creation error:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message,
      error?.error || error,
      context
    );
  }
}
