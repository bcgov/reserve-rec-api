// Get bookings by collection - handles both /bookings/collection and /bookings/collection/{collectionId}

const { logger, sendResponse } = require("/opt/base");
const {
  getBookingByBookingId,
  validateAdminRequirements,
  calculateDateRange,
  validateDateRange,
  buildActivityFilters,
  validateCollectionAccess,
  fetchBookingsWithPagination
} = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings Collection GET:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Extract query parameters
    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId
    const activityType = event?.queryStringParameters?.activityType
    const activityId = event?.queryStringParameters?.activityId
    const startDate = event?.queryStringParameters?.startDate
    const endDate = event?.queryStringParameters?.endDate
    const bookingId = event?.queryStringParameters?.bookingId
    const limit = event?.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit, 10) : 20;
    const lastEvaluatedKey = event?.queryStringParameters?.lastEvaluatedKey ? 
      JSON.parse(decodeURIComponent(event.queryStringParameters.lastEvaluatedKey)) : null;
      const sortOrder = event?.queryStringParameters?.sortOrder || 'asc';
    const sortBy = event?.queryStringParameters?.sortBy || 'startDate';

    // Validate sortBy parameter
    const validSortFields = ['startDate', 'endDate', 'collectionId', 'activityType', 'activityId'];
    if (!validSortFields.includes(sortBy)) {
      throw new Exception("Invalid sortBy parameter. Must be one of: startDate, endDate, collectionId, activityType, activityId", {
        code: 400
      });
    }
  
    // Get user object and validate admin requirements
    // const userObject = event.requestContext.authorizer;

    // TODO: remove eventually - mock data for testing
    userObject = {
      sub: "12345678-1234-1234-1234-123456789012",
      email: "test@test.com",
      isAdmin: false,
      collection: ["bcparks_250", "bcparks_143"],
      isAuthenticated: true,
    };
    validateAdminRequirements(userObject, collectionId);

    // Calculate effective date range
    const { effectiveStartDate, effectiveEndDate } = calculateDateRange(userObject, startDate, endDate);
    validateDateRange(effectiveStartDate, effectiveEndDate, userObject.isAdmin);

    // Determine collections and validate access
    let collections = [];
    if (collectionId) {
      // Handle multiple collection IDs (comma-separated, e.g. bcparks_123,bcparks_456)
      collections = collectionId.split(',').map(id => id.trim()).filter(id => id.length > 0);
    } else {
      // Otherwise, use all collections the user has access to from their user object
      collections = userObject?.collection || [];
    }

    validateCollectionAccess(collections, userObject);

    // Handle single booking request if that's provided
    if (bookingId) {
      const booking = await getBookingByBookingId(bookingId, true);
      return sendResponse(200, booking, "Success", null, context);
    }

    // Otherwise, fetch the activity filters based on activityType and activityId
    const filters = buildActivityFilters(activityType, activityId);

    // Fetch bookings with pagination
    const allBookings = await fetchBookingsWithPagination(
      collections, 
      filters, 
      effectiveStartDate, 
      effectiveEndDate, 
      limit, 
      lastEvaluatedKey, 
      sortOrder,
      sortBy
    );

    return sendResponse(200, {
      items: allBookings.items,
      lastEvaluatedKey: allBookings.lastEvaluatedKey ? encodeURIComponent(JSON.stringify(allBookings.lastEvaluatedKey)) : null,
      hasMore: !!allBookings.lastEvaluatedKey
    }, "Success", null, context);

  } catch (error) {
    logger.error("Error in Bookings Collection GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
