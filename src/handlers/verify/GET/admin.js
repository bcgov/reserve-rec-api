// Verify booking QR code - GET /verify/:bookingId/:hash (Admin only)

const { logger, sendResponse, getRequestClaimsFromEvent, Exception, writeAuditLog, validateSuperAdminAuth, handleCORS, calculatePartySize, VALIDATION_PATTERNS } = require("/opt/base");
const { validateHash } = require("../../../../lib/handlers/emailDispatch/qrCodeHelper");
const { getBookingByBookingId } = require("../../bookings/methods");
const { batchWriteData, AUDIT_TABLE_NAME, marshall } = require("/opt/dynamodb");

/**
 * Send invalid QR code response
 * @param {Object} context - Lambda context
 * @returns {Object} Response object
 */
function sendInvalidQRResponse(context) {
  return sendResponse(400, { 
    valid: false,
    reason: "Invalid or expired QR code"
  }, "Invalid QR code", null, context);
}

exports.handler = async (event, context) => {
  const timestamp = new Date().toISOString();
  const bookingId = event.pathParameters?.bookingId;
  const hash = event.pathParameters?.hash;
  let claims = null;
  
  // Log request metadata only (not full event)
  logger.info("Verify Booking GET (Admin):", {
    method: event.httpMethod,
    hasBookingId: !!bookingId,
    hasHash: !!hash,
    timestamp
  });

  // Handle CORS preflight
  const corsResponse = handleCORS(event, context);
  if (corsResponse) return corsResponse;

  try {
    // Validate admin authorization
    try {
      claims = validateSuperAdminAuth(event, 'QR verification');
    } catch (authError) {
      // Log unauthorized attempt to audit table
      const sourceIp = event.requestContext?.identity?.sourceIp || 'unknown';
      const userAgent = event.requestContext?.identity?.userAgent || 'unknown';
      
      logger.warn('Unauthorized QR verification attempt', { 
        bookingId, 
        sourceIp,
        userAgent,
        error: authError.message 
      });
      
      // Write unauthorized attempt to audit log
      await writeAuditLog(
        'UNAUTHORIZED', 
        bookingId || 'unknown', 
        'QR_VERIFY_UNAUTHORIZED', 
        {
          sourceIp,
          userAgent,
          hasToken: !!(event.requestContext?.authorizer?.claims || getRequestClaimsFromEvent(event)),
          reason: authError.message,
          timestamp
        },
        marshall,
        batchWriteData,
        AUDIT_TABLE_NAME
      );
      
      // TODO: Flag repeated unauthorized attempts from same IP to AWS WAF for blocking
      // Consider implementing rate limiting:
      // - Track failed attempts by IP in DynamoDB/ElastiCache
      // - After N failures in X minutes, add IP to WAF IP set
      // - Implement exponential backoff or CAPTCHA challenge
      // - Alert security team for suspicious patterns
      
      throw authError;
    }

    if (!bookingId || !hash) {
      await writeAuditLog(claims.sub, bookingId || 'unknown', 'QR_VERIFY_FAILED', {
        reason: 'Missing parameters',
        timestamp
      }, marshall, batchWriteData, AUDIT_TABLE_NAME);
      throw new Exception("Missing required parameters: bookingId and hash", { code: 400 });
    }

    // Validate bookingId format (UUID format)
    if (!VALIDATION_PATTERNS.BOOKING_ID.test(bookingId)) {
      logger.warn("Invalid bookingId format", { bookingIdLength: bookingId.length });
      await writeAuditLog(claims.sub, bookingId, 'QR_VERIFY_FAILED', {
        reason: 'Invalid bookingId format',
        timestamp
      }, marshall, batchWriteData, AUDIT_TABLE_NAME);
      return sendInvalidQRResponse(context);
    }

    // Validate hash format (16 hexadecimal characters)
    if (!VALIDATION_PATTERNS.QR_HASH.test(hash)) {
      logger.warn("Invalid hash format", { hashLength: hash.length });
      await writeAuditLog(claims.sub, bookingId, 'QR_VERIFY_FAILED', {
        reason: 'Invalid hash format',
        timestamp
      }, marshall, batchWriteData, AUDIT_TABLE_NAME);
      return sendInvalidQRResponse(context);
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
      await writeAuditLog(claims.sub, bookingId, 'QR_VERIFY_FAILED', {
        reason: 'Booking not found',
        timestamp
      }, marshall, batchWriteData, AUDIT_TABLE_NAME);
      return sendInvalidQRResponse(context);
    }

    if (!booking) {
      // Return same generic error as invalid hash to prevent enumeration
      logger.warn("Booking not found (null result)", { bookingId });
      await writeAuditLog(claims.sub, bookingId, 'QR_VERIFY_FAILED', {
        reason: 'Booking not found (null)',
        timestamp
      }, marshall, batchWriteData, AUDIT_TABLE_NAME);
      return sendInvalidQRResponse(context);
    }

    // Step 2: Validate the hash (after confirming booking exists)
    const isValidHash = validateHash(bookingId, hash);

    if (!isValidHash) {
      logger.warn("Invalid QR code hash", { bookingId, verifiedBy: claims.sub });
      await writeAuditLog(claims.sub, bookingId, 'QR_VERIFY_FAILED', {
        reason: 'Invalid hash',
        bookingStatus: booking.bookingStatus,
        timestamp
      }, marshall, batchWriteData, AUDIT_TABLE_NAME);
      return sendInvalidQRResponse(context);
    }

    logger.info("QR code hash validated successfully", { bookingId, verifiedBy: claims.sub });

    // Step 3: Check booking status
    const bookingStatus = booking.bookingStatus;
    const isExpired = booking.sessionExpiry && new Date(booking.sessionExpiry) < new Date();
    const isCancelled = bookingStatus === "cancelled";
    const isConfirmed = bookingStatus === "confirmed";

    // Calculate party size using utility function
    const partySize = calculatePartySize(booking.partyInformation);

    // Write successful verification to audit log
    await writeAuditLog(claims.sub, bookingId, 'QR_VERIFY_SUCCESS', {
      bookingStatus,
      isExpired,
      isCancelled,
      isConfirmed,
      partySize,
      collectionId: booking.collectionId,
      activityType: booking.activityType,
      startDate: booking.startDate,
      endDate: booking.endDate,
      timestamp
    }, marshall, batchWriteData, AUDIT_TABLE_NAME);

    logger.info("QR code verification completed", {
      bookingId,
      status: bookingStatus,
      isExpired,
      isCancelled,
      isConfirmed,
      verifiedBy: claims.sub,
      verifiedAt: timestamp
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
