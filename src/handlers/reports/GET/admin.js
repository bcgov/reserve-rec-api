/**
 * Daily Passes Report - GET /reports/daily-passes
 *
 * Returns day-use booking data for a specific park and arrival date,
 * formatted for CSV export.
 *
 * Query Parameters:
 *   - collectionId (required): Park identifier (e.g., "bcparks_123")
 *   - arrivalDate (required): Date in YYYY-MM-DD format
 *   - facilityId (optional): Filter by specific activity/facility ID
 */

const { logger, sendResponse, handleCORS, Exception, validateSuperAdminAuth } = require("/opt/base");
const { runQuery, getOne, TRANSACTIONAL_DATA_TABLE_NAME, REFERENCE_DATA_TABLE_NAME } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("Daily Passes Report GET:", event);

  const corsResponse = handleCORS(event, context);
  if (corsResponse) return corsResponse;

  try {
    // Validate SuperAdmin authorization
    validateSuperAdminAuth(event, 'daily passes report');

    // Extract and validate query params
    const params = event?.queryStringParameters || {};
    const { collectionId, facilityId, arrivalDate } = params;

    if (!collectionId) {
      throw new Exception("collectionId is required", { code: 400 });
    }
    if (!arrivalDate) {
      throw new Exception("arrivalDate is required", { code: 400 });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)) {
      throw new Exception("arrivalDate must be in YYYY-MM-DD format", { code: 400 });
    }

    // Resolve park display name
    const parkName = await resolveCollectionDisplayName(collectionId);

    // Fetch day-use activities for this collection
    const activities = await fetchDayUseActivities(collectionId, facilityId);

    if (!activities.length) {
      return sendResponse(200, {
        items: [],
        count: 0,
        collectionId,
        arrivalDate
      }, "Success", null, context);
    }

    // Fetch bookings for each activity on the given date
    const allBookings = [];
    for (const activity of activities) {
      const bookings = await fetchBookingsForActivity(
        collectionId,
        activity.activityType,
        activity.activityId,
        arrivalDate
      );

      // Resolve facility display name from the activity's linked facilities
      const facilityDisplayName = await resolveFacilityDisplayName(activity);

      // Add facility display name to each booking
      bookings.forEach(booking => {
        booking._facilityDisplayName = facilityDisplayName;
      });

      allBookings.push(...bookings);
    }

    // Format response with all CSV fields
    const formattedBookings = allBookings.map(booking =>
      formatBookingForReport(booking, parkName)
    );

    return sendResponse(200, {
      items: formattedBookings,
      count: formattedBookings.length,
      collectionId,
      arrivalDate
    }, "Success", null, context);

  } catch (error) {
    logger.error("Error in Daily Passes Report GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};

/**
 * Fetches day-use activities for a collection, optionally filtered by activityId
 */
async function fetchDayUseActivities(collectionId) {
  try {
    const queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :activityType)",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${collectionId}` },
        ":activityType": { S: "dayuse" },
      },
    };

    const result = await runQuery(queryObj);
    return result.items || [];
  } catch (error) {
    logger.error("Error fetching day-use activities:", error);
    throw new Exception("Error fetching activities", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

/**
 * Fetches bookings for a specific activity on a given date
 */
async function fetchBookingsForActivity(collectionId, activityType, activityId, arrivalDate) {
  try {
    const queryObj = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `booking::${collectionId}::${activityType}::${activityId}` },
        ":sk": { S: arrivalDate },
      },
    };

    const result = await runQuery(queryObj);
    return result.items || [];
  } catch (error) {
    logger.error("Error fetching bookings:", error);
    throw new Exception("Error fetching bookings", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

/**
 * Resolves the display name for a collection (park)
 * collectionId format: "bcparks_{orcs}"
 */
async function resolveCollectionDisplayName(collectionId) {
  try {
    // Extract orcs from collectionId (e.g., "bcparks_123" -> "123")
    const orcs = collectionId.replace('bcparks_', '');

    const protectedArea = await getOne('protectedArea', orcs);
    return protectedArea?.displayName || protectedArea?.legalName || collectionId;
  } catch (error) {
    logger.warn("Could not resolve collection display name:", error);
    return collectionId;
  }
}

/**
 * Resolves the facility display name from an activity's linked facilities
 * Returns the first facility's displayName, or empty string if none found
 */
async function resolveFacilityDisplayName(activity) {
  try {
    const facilities = activity.facilities || [];
    if (facilities.length === 0) {
      return '';
    }

    // Get the first facility reference
    const facilityRef = facilities[0];
    const facilityPk = facilityRef.pk;
    const facilitySk = facilityRef.sk;

    if (!facilityPk || !facilitySk) {
      return '';
    }

    // Fetch the facility record
    const queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: {
        ":pk": { S: facilityPk },
        ":sk": { S: facilitySk },
      },
    };

    const result = await runQuery(queryObj);
    const facility = result.items?.[0];
    return facility?.displayName || '';
  } catch (error) {
    logger.warn("Could not resolve facility display name:", error);
    return '';
  }
}

/**
 * Formats a booking record for the CSV report
 */
function formatBookingForReport(booking, parkName) {
  const partyInfo = booking.partyInformation || {};
  const namedOccupant = booking.namedOccupant || {};
  const contactInfo = namedOccupant.contactInfo || {};
  const vehicleInfo = booking.vehicleInformation?.[0] || {};

  const isVehiclePass = booking.activitySubType === 'vehicleParking';
  const isTrailPass = booking.activitySubType === 'trailUse';

  // Calculate trail pass count from party information
  const trailCount = isTrailPass
    ? (partyInfo.adult || 0) + (partyInfo.child || 0) + (partyInfo.senior || 0) + (partyInfo.youth || 0)
    : 0;

  // Map booking status to transaction status
  let transactionStatus;
  switch (booking.bookingStatus) {
    case 'confirmed':
      transactionStatus = 'Reserved';
      break;
    case 'cancelled':
      transactionStatus = 'Cancelled';
      break;
    default:
      transactionStatus = booking.bookingStatus || '';
  }

  return {
    accountName: `${namedOccupant.firstName || ''} ${namedOccupant.lastName || ''}`.trim(),
    emailAddress: contactInfo.email || '',
    phoneNumber: contactInfo.mobilePhone || contactInfo.homePhone || '',
    streetAddress: contactInfo.streetAddress || '',
    provinceTerritory: contactInfo.province || '',
    country: contactInfo.country || '',
    postalCode: contactInfo.postalCode || '',
    licensePlate: vehicleInfo.licensePlate || '',
    reservationNumber: booking.bookingId || booking.globalId || '',
    transactionStatus: transactionStatus,
    park: parkName,
    facility: booking._facilityDisplayName || booking.displayName || '',
    arrivalDate: booking.startDate || '',
    passType: isVehiclePass ? 'Vehicle' : isTrailPass ? 'Trail' : '',
    vehiclePassReservedCount: isVehiclePass && booking.bookingStatus === 'confirmed' ? 1 : 0,
    vehiclePassCancelledCount: 0, // MVP: always 0
    trailPassesReservedCount: isTrailPass && booking.bookingStatus === 'confirmed' ? trailCount : 0,
    trailPassesCancelledCount: 0, // MVP: always 0
  };
}
