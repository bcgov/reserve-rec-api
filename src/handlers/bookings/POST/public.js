// Create new booking
const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { createBooking } = require("../methods");
const { BOOKING_PUT_CONFIG } = require("../configs");
const { quickApiPutHandler } = require("../../../common/data-utils");
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


    // Validate required parameters
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!body.userId) missingParams.push("userId (authentication required)");
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");
    if (!startDate) missingParams.push("startDate");

    // 401 if userId is missing, 400 for others
    if (missingParams.length > 0) {
      const code = !body.userId ? 401 : 400;
      const message = !body.userId 
        ? "Unauthorized: Authentication required to create booking"
        : `Cannot create booking - missing required parameter(s): ${missingParams.join(", ")}`;
      throw new Exception(message, { code });
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

    // If this is a guest user, prepare the response with guest sub header
    const responseOptions = {};
    if (body.userId && body.userId.startsWith('guest-')) {
      responseOptions.guestSub = body.userId;
    }

    return sendResponse(200, response, "Success", null, context, responseOptions);

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
