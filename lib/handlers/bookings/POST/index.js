// Create new booking
const { Exception, logger, sendResponse } = require("/opt/base");
const { createBooking } = require("/opt/bookings/methods");
const { BOOKING_PUT_CONFIG } = require("/opt/bookings/configs");
const { quickApiPutHandler } = require("/opt/data-utils");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("Bookings POST:", event);

  try {
    // Get relevant data from the event

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    const acCollectionId = event?.pathParameters?.acCollectionId || event?.queryStringParameters?.acCollectionId || body?.acCollectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || body?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || body?.activityId;
    const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate || body?.startDate;


    if (!acCollectionId || !activityType || !activityId || !startDate) {
      throw new Exception("Activity Collection ID (acCollectionId), Activity Type (activityType), Activity ID (activityId) and Start Date (startDate) are required", { code: 400 });
    }

    let postRequests = await createBooking(acCollectionId, activityType, activityId, startDate, body);

    const putItems = await quickApiPutHandler(
      TABLE_NAME,
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
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message,
      error?.error || error,
      context
    );
  }
}
