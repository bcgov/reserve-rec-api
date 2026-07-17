// Public GET handlers for bookings. This is used to get bookings for the logged-in userId. userId can only see their own bookings, but they can filter by various parameters.

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { getBookingsByUserId, getBookingByBookingId } = require("../methods");

/**
 * Generate QR code data for a booking (only for confirmed bookings)
 * @param {string} bookingId - The booking ID
 * @param {object} booking - The booking object
 * @returns {Promise<object|null>} QR code data or null
 */
async function generateQRCodeForBooking(bookingId, booking) {
  // QR is enabled by default; set ENABLE_BOOKING_QR=false to disable explicitly.
  if (process.env.ENABLE_BOOKING_QR === 'false') {
    return null;
  }

  // Only generate QR codes for confirmed bookings
  const bookingIsConfirmed = booking?.status === 'confirmed' || booking?.status === 'confirmed';
  if (!bookingIsConfirmed) {
    return null;
  }

  try {
    // Lazy-load QR utilities to avoid loading heavy dependencies for non-confirmed bookings.
    const { generateQRURL, generateQRCodeDataURL } = require("../../../../lib/handlers/emailDispatch/qrCodeHelper");
    const qrUrl = generateQRURL(bookingId);
    const qrCodeDataUrl = await generateQRCodeDataURL(qrUrl);
    return {
      dataUrl: qrCodeDataUrl,
      verificationUrl: qrUrl
    };
  } catch (error) {
    logger.warn('Failed to generate QR code for booking', {
      bookingId,
      error: error.message
    });
    // Don't fail the request if QR generation fails
    return null;
  }
}

exports.handler = async (event, context) => {
  logger.info('Bookings GET Activated', {
    bookingId: event?.pathParameters?.bookingId || event?.queryStringParameters?.bookingId || null,
  });

  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  try {
    // Get relevant data from the event
    // Search by ID
    const bookingId = event?.pathParameters?.bookingId || event?.queryStringParameters?.bookingId;
    const fetchAccessPoints = event?.queryStringParameters?.fetchAccessPoints || false;

    // Bookings can only be made by authenticated users (see bookings/POST/public.js),
    // so every legitimate lookup happens on behalf of a known Cognito sub. The
    // older `?email=` guest lookup path has been removed: it bypassed ownership
    // verification and allowed any caller with a booking ID + a matching
    // namedOccupant email to view someone else's booking.
    const userId = getRequestClaimsFromEvent(event)?.sub || null;
    if (!userId) {
      throw new Exception(
        "Unauthorized: authentication required to view bookings",
        { code: 401 }
      );
    }

    // If bookingId is provided, fetch that specific booking
    if (bookingId) {
      const booking = await getBookingByBookingId(bookingId, fetchAccessPoints);

      if (booking?.userId !== userId) {
        throw new Exception(
          `Forbidden: User ${userId} does not have access to booking ${bookingId}`,
          { code: 403 }
        );
      }
      const qrCodeData = await generateQRCodeForBooking(bookingId, booking);
      return sendResponse(200, { ...booking, qrCode: qrCodeData }, "Success", null, context);
    }

    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId;
    const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate;
    const endDate = event?.pathParameters?.endDate || event?.queryStringParameters?.endDate || null;

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
