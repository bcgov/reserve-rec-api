// Get every booking belonging to a single customer - GET /bookings/admin/user/{userId}
// Backs the "Current bookings" / "Past bookings" sections of the admin customer detail view.

const {
  Exception,
  logger,
  sendResponse,
  handleCORS,
  checkAuthContext,
} = require("/opt/base");
const { getBookingsByUserId } = require("../../../../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings Admin User GET:", event);

  // Handle CORS preflight
  const corsResponse = handleCORS(event, context);
  if (corsResponse) return corsResponse;

  try {
    // Re-check the tier in the handler rather than trusting the authorizer alone —
    // this endpoint exposes an arbitrary customer's bookings by their Cognito sub.
    checkAuthContext(event, "staff");

    const userId = event?.pathParameters?.userId;
    if (!userId) {
      throw new Exception("userId is required", { code: 400 });
    }

    const params = event?.queryStringParameters || {};

    const filters = {
      startDate: params?.startDate || null,
      endDate: params?.endDate || null,
      limit: params?.limit ? parseInt(params.limit, 10) : null,
      lastEvaluatedKey: params?.lastEvaluatedKey
        ? JSON.parse(params.lastEvaluatedKey)
        : null,
    };

    const bookings = await getBookingsByUserId(userId, filters);

    return sendResponse(
      200,
      {
        items: bookings?.items || [],
        lastEvaluatedKey: bookings?.lastEvaluatedKey || null,
        hasMore: !!bookings?.lastEvaluatedKey,
      },
      "Success",
      null,
      context
    );
  } catch (error) {
    logger.error("Error in Bookings Admin User GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
