// Get booking

const { Exception, logger, sendResponse } = require("/opt/base");
const { getBookingByBookingId, getBookingsByActivityDetails, getBookingsByUserSub } = require("../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings GET:", event);

  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  try {
    // Get relevant data from the event
    // Search by ID
    const bookingId = event?.pathParameters?.bookingId || event?.queryStringParameters?.bookingId;

    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId;
    const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate;
    const endDate = event?.pathParameters?.endDate || event?.queryStringParameters?.endDate || null;
    const fetchAccessPoints = event?.queryStringParameters?.fetchAccessPoints || false;

    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!userId) {
      throw new Exception("Unauthorized: userId ID not found in request claims", { code: 401 });
    }

    if (bookingId) {
      // Get booking by bookingId
      const booking = await getBookingByBookingId(bookingId, userId, fetchAccessPoints);
      return sendResponse(200, booking, "Success", null, context);
    }

    if (!collectionId || !activityType || !activityId || !startDate) {
      throw new Exception("Booking ID (bookingId) OR Activity Collection ID (collectionId), Activity Type (activityType), Activity ID (activityId) and Start Date (startDate) are required", { code: 400 });
    }

    const bookings = await getBookingsByActivityDetails(collectionId, activityType, activityId, startDate, endDate);

    return sendResponse(200, bookings, "Success", null, context);

  } catch (error) {
    logger.error("Error in bookings GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
