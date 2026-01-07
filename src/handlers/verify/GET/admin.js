// Verify booking QR code - GET /verify/:bookingId/:hash (Admin only)

const { logger, sendResponse, getRequestClaimsFromEvent, Exception } = require("/opt/base");
const { validateHash } = require("../../../../lib/handlers/emailDispatch/qrCodeHelper");
const { getBookingByBookingId } = require("../../bookings/methods");

/**
 * Validate SuperAdmin authorization from event claims
 * @param {Object} event - Lambda event
 * @returns {Object} Claims object if authorized
 * @throws {Exception} If user is not a SuperAdmin
 */
function validateSuperAdminAuth(event) {
  // Extract claims from authorizer context
  const claims = event.requestContext?.authorizer?.claims || getRequestClaimsFromEvent(event);
  
  if (!claims) {
    logger.warn('No authorization claims found in request');
    throw new Exception("Unauthorized - Authentication required", { code: 401 });
  }
  
  // Check if user is a SuperAdmin
  const cognitoGroups = claims['cognito:groups'] || [];
  const isSuperAdmin = cognitoGroups.some(group => 
    group.includes('SuperAdminGroup')
  );

  if (!isSuperAdmin) {
    logger.warn(`Unauthorized QR verification attempt by user ${claims.sub}`);
    throw new Exception("Forbidden - SuperAdmin access required", { code: 403 });
  }

  logger.info(`SuperAdmin QR verification access granted for user ${claims.sub}`);
  return claims;
}

exports.handler = async (event, context) => {
  // Log request metadata only (not full event)
  logger.info("Verify Booking GET (Admin):", {
    method: event.httpMethod,
    hasBookingId: !!event.pathParameters?.bookingId,
    hasHash: !!event.pathParameters?.hash
  });

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Validate admin authorization
    const claims = validateSuperAdminAuth(event);

    // Extract bookingId and hash from path parameters
    const bookingId = event.pathParameters?.bookingId;
    const hash = event.pathParameters?.hash;

    if (!bookingId || !hash) {
      throw new Exception("Missing required parameters: bookingId and hash", { code: 400 });
    }

    // Validate bookingId format (UUID format)
    if (!/^[a-zA-Z0-9-_]{8,100}$/.test(bookingId)) {
      logger.warn("Invalid bookingId format", { bookingIdLength: bookingId.length });
      return sendResponse(400, { 
        valid: false,
        reason: "Invalid or expired QR code"
      }, "Invalid QR code", null, context);
    }

    // Validate hash format (16 hexadecimal characters)
    if (!/^[a-f0-9]{16}$/i.test(hash)) {
      logger.warn("Invalid hash format", { hashLength: hash.length });
      return sendResponse(400, { 
        valid: false,
        reason: "Invalid or expired QR code"
      }, "Invalid QR code", null, context);
    }

    logger.info("Verifying QR code", { bookingId, userId: claims.sub });

    // Step 1: Fetch the booking from database FIRST (before hash validation)
    // This prevents timing attacks that could reveal if a bookingId exists
    let booking;
    try {
      booking = await getBookingByBookingId(bookingId, null, true); // fetch with access points
    } catch (error) {
      // Return same generic error as invalid hash to prevent enumeration
      logger.warn("Booking not found for QR verification", { bookingId });
      return sendResponse(400, {
        valid: false,
        reason: "Invalid or expired QR code"
      }, "Invalid QR code", null, context);
    }

    if (!booking) {
      // Return same generic error as invalid hash to prevent enumeration
      logger.warn("Booking not found (null result)", { bookingId });
      return sendResponse(400, {
        valid: false,
        reason: "Invalid or expired QR code"
      }, "Invalid QR code", null, context);
    }

    // Step 2: Validate the hash (after confirming booking exists)
    const isValidHash = validateHash(bookingId, hash);

    if (!isValidHash) {
      logger.warn("Invalid QR code hash", { bookingId, verifiedBy: claims.sub });
      return sendResponse(400, { 
        valid: false,
        reason: "Invalid or expired QR code"
      }, "Invalid QR code", null, context);
    }

    logger.info("QR code hash validated successfully", { bookingId, verifiedBy: claims.sub });

    // Step 3: Check booking status
    const bookingStatus = booking.bookingStatus;
    const isExpired = booking.sessionExpiry && new Date(booking.sessionExpiry) < new Date();
    const isCancelled = bookingStatus === "cancelled";
    const isConfirmed = bookingStatus === "confirmed";

    // Calculate party size (aggregate count, not detailed breakdown)
    const partySize = (booking.partyInformation?.adult || 0) + 
                     (booking.partyInformation?.senior || 0) +
                     (booking.partyInformation?.youth || 0) +
                     (booking.partyInformation?.child || 0);

    // Log verification attempt for audit trail
    logger.info("QR code verification completed", {
      bookingId,
      status: bookingStatus,
      isExpired,
      isCancelled,
      isConfirmed,
      verifiedBy: claims.sub,
      verifiedAt: new Date().toISOString()
    });

    // Step 4: Return MINIMAL booking details (prevent excessive PII disclosure)
    // Only include information necessary for park staff to verify the reservation
    const response = {
      valid: true,
      bookingId: booking.bookingId,
      status: bookingStatus,
      statusDetails: {
        isConfirmed,
        isCancelled,
        isExpired,
        isPending: bookingStatus === "in progress"
      },
      booking: {
        // Core verification info only
        bookingId: booking.bookingId,
        displayName: booking.displayName,
        
        // Dates (needed to verify reservation period)
        startDate: booking.startDate,
        endDate: booking.endDate,
        
        // Guest name only (no email, phone, or address)
        guestName: booking.namedOccupant 
          ? `${booking.namedOccupant.firstName} ${booking.namedOccupant.lastName}`
          : null,
        
        // Party size only (not detailed age breakdown)
        partySize: partySize,
        
        // Location info (needed to verify correct park/activity)
        collectionId: booking.collectionId,
        activityType: booking.activityType,
        displayName: booking.displayName,
        
        // Access points (if available, for trail/backcountry permits)
        entryPoint: booking.entryPoint,
        exitPoint: booking.exitPoint,
        location: booking.location,
        
        // Vehicle info (if available, for parking passes)
        vehicleInformation: booking.vehicleInformation,
        
        // DO NOT include: 
        // - namedOccupant (contains email, phone, address)
        // - partyInformation (age breakdown not needed)
        // - feeInformation (payment details not needed for verification)
        // - sessionId, sessionExpiry (internal session state)
        // - globalId, activityId (internal IDs)
        // - equipmentInformation (not needed for basic verification)
        // - bookedAt (not needed for verification)
      },
      verificationMetadata: {
        verifiedAt: new Date().toISOString(),
        verifiedBy: claims.sub
        // DO NOT include verifierEmail (not needed in response)
      }
    };

    return sendResponse(200, response, "Success", null, context);

  } catch (error) {
    logger.error("Error in Verify Booking GET:", error);
    return sendResponse(
      Number(error?.code) || 500,
      error?.data || null,
      error?.msg || "Error verifying booking",
      error?.error || error,
      context
    );
  }
};
