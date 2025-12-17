// Search bookings by various filters - POST /bookings/admin/search

const { logger, sendResponse, getRequestClaimsFromEvent, Exception } = require("/opt/base");
const {
  getBookingByBookingId,
  validateAdminRequirements,
  calculateDateRange,
  validateDateRange,
  buildActivityFilters,
  validateCollectionAccess,
  fetchBookingsWithPagination
} = require("../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings Admin Search POST:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Get JWT claims from the event
    let claims;

    // TODO: this should probably be handled differently, but for local testing we can use mock claims
    //       because the authorizer is not invoked in SAM local
    if (process.env.AWS_SAM_LOCAL === 'true' || !event.requestContext?.authorizer) {
      // Local testing - use mock claims
      claims = event.requestContext?.authorizer?.claims || {
        sub: "test-user-id",
        "cognito:groups": ["ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup"],
        email: "test@example.com"
      };
      logger.info("Using mock claims for local testing");
    } else {
      claims = getRequestClaimsFromEvent(event);
    }
    
    // Check if user is a SuperAdmin by looking for the group in cognito:groups
    const cognitoGroups = claims['cognito:groups'] || [];
    const isSuperAdmin = cognitoGroups.some(group => 
      group.includes('SuperAdminGroup')
    );

    if (!isSuperAdmin) {
      logger.warn(`Unauthorized access attempt by user ${claims.sub}`);
      return sendResponse(403, null, "Forbidden - SuperAdmin access required", null, context);
    }

    logger.info(`SuperAdmin access granted for user ${claims.sub}`);

    // Extract search parameters from request query string
    const params = event?.queryStringParameters || {};
    const collectionId = params?.collectionId;
    const activityType = params?.activityType;
    const activityId = params?.activityId;
    const startDate = params?.startDate;
    const endDate = params?.endDate;
    const bookingId = params?.bookingId;
    const limit = params?.limit ? parseInt(params.limit, 10) : 20;
    const lastEvaluatedKey = params?.lastEvaluatedKey ? JSON.parse(params.lastEvaluatedKey) : null;
    const sortOrder = params?.sortOrder || 'asc';
    const sortBy = params?.sortBy || 'startDate';

    // Build user object for validation functions
    const userObject = {
      sub: claims.sub,
      isAdmin: isSuperAdmin,
      collection: [], // SuperAdmin has access to all collections
      isAuthenticated: true,
    };

    
    // Handle single booking request first if only the bookingId is provided
    if (bookingId && !collectionId && !activityType && !activityId && !startDate && !endDate) {
      const booking = await getBookingByBookingId(bookingId, userObject?.sub, false);
      return sendResponse(200, { items: [booking] }, "Success", null, context);
    }
    
    // Validate search requires at least one filter when bookingId is not provided
    const hasFilters = collectionId || activityType || activityId || startDate || endDate;
    if (!hasFilters) {
      throw new Exception(
        "Search requires either a bookingId or at least one filter (collectionId, activityType, activityId, startDate, or endDate)",
        { code: 400 }
      );
    }
    
    // Validate sortBy parameter for filtered searches
    const validSortFields = ['startDate', 'endDate', 'collectionId', 'activityType', 'activityId'];
    if (!validSortFields.includes(sortBy)) {
      throw new Exception("Invalid sortBy parameter. Must be one of: startDate, endDate, collectionId, activityType, activityId", {
        code: 400
      });
    }

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
      lastEvaluatedKey: allBookings.lastEvaluatedKey,
      hasMore: !!allBookings.lastEvaluatedKey
    }, "Success", null, context);

  } catch (error) {
    logger.error("Error in Bookings Admin Search POST:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
