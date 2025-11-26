// Public GET handlers for bookings. This is used to get bookings for the logged-in userId. userId can only see their own bookings, but they can filter by various parameters.

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { getBookingsByUserId, getBookingByBookingId } = require("../methods");

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
    const fetchAccessPoints = event?.queryStringParameters?.fetchAccessPoints || false;

    // If bookingId is provided, fetch that specific booking
    if (bookingId) {
      const booking = await getBookingByBookingId(bookingId, fetchAccessPoints);
      return sendResponse(200, booking, "Success", null, context);
    }

    // Otherwise, fetch bookings by userId with optional filters
    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId;
    const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate;
    const endDate = event?.pathParameters?.endDate || event?.queryStringParameters?.endDate || null;

    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!userId) {
      throw new Exception("Unauthorized: userId ID not found in request claims", { code: 401 });
    }

    const filters = {
      collectionId: collectionId,
      activityType: activityType,
      activityId: activityId,
      startDate: startDate,
      endDate: endDate,
      bookingId: bookingId,
      fetchAccessPoints: fetchAccessPoints,
    }

    const bookings = await getBookingsByUserId(userId, filters);
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
