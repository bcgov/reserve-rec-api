// Get every booking belonging to a single customer - GET /bookings/admin/user/{userId}
// Backs the "Current bookings" / "Past bookings" sections of the admin customer detail view.
//
// Why this reads the userId GSI directly instead of going through POST /bookings/search:
// the search endpoint has no userId filter (it matches on free text and collection/activity
// facets), it reads OpenSearch, which lags the transactional table by an indexing hop, and a
// customer profile needs the exact, complete set of that customer's bookings rather than a
// relevance-ranked approximation. The GSI is keyed on userId, so this is a single query.

const {
  Exception,
  logger,
  sendResponse,
  handleCORS,
  checkAuthContext,
} = require("/opt/base");
const { getBookingsByUserId } = require("../../../../methods");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Whitelist, not blacklist: a stored booking document also carries fee context, occupant
// contact details and internal policy snapshots. The customer detail cards need none of
// those, and a whitelist means attributes added to the schema later cannot leak by default.
const BOOKING_RESPONSE_FIELDS = [
  "pk",
  "sk",
  "bookingId",
  "displayName",
  "startDate",
  "endDate",
  "status",
  "reservationContext",
  "partyContext",
  "facilityDisplayName",
  "geozoneDisplayName",
  "bookingCompletionTime",
  "bookedAt",
  "quantity",
];

function projectBooking(booking) {
  const projected = {};
  for (const field of BOOKING_RESPONSE_FIELDS) {
    if (booking?.[field] !== undefined) {
      projected[field] = booking[field];
    }
  }
  return projected;
}

function parseLimit(rawLimit) {
  if (!rawLimit) return DEFAULT_LIMIT;
  const limit = parseInt(rawLimit, 10);
  if (isNaN(limit) || limit < 1) {
    throw new Exception("limit must be a positive integer", { code: 400 });
  }
  return Math.min(limit, MAX_LIMIT);
}

function parseLastEvaluatedKey(rawKey) {
  if (!rawKey) return null;
  try {
    return JSON.parse(rawKey);
  } catch {
    throw new Exception("lastEvaluatedKey must be valid JSON", { code: 400 });
  }
}

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
      limit: parseLimit(params?.limit),
      lastEvaluatedKey: parseLastEvaluatedKey(params?.lastEvaluatedKey),
      // Newest booking first, so page one is the part of the history staff care about.
      scanIndexForward: false,
    };

    const bookings = await getBookingsByUserId(userId, filters);

    // The query already filters on schema; repeated here so a regression in the
    // FilterExpression cannot surface bookingDate children as half-empty cards.
    const bookingItems = (bookings?.items || []).filter(
      (item) => item?.schema === "booking"
    );

    return sendResponse(
      200,
      {
        items: bookingItems.map(projectBooking),
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
