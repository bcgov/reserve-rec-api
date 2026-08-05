// Import necessary libraries and modules
const {
  OSQuery,
  OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME,
  nonKeyableTerms,
} = require("/opt/opensearch");
const {
  sendResponse,
  logger,
  handleCORS,
  checkAuthContext,
  effectiveCollectionRole,
  calculatePartySize,
} = require("/opt/base");
// Lambda function entry point
exports.handler = async function (event, context) {
  logger.debug("Search:", event);

  // Handle CORS preflight
  const corsResponse = handleCORS(event, context);
  if (corsResponse) return corsResponse;

  try {
    const authContext = checkAuthContext(event, "limited");

    const body = JSON.parse(event?.body) || {};
    const userQuery = body?.text;

    // Use a dedicated filter object for precise field matching
    // and a text string for the general fuzzy search.
    const searchOptions = {
      from: body?.from || 0,
      size: body?.size || 5, // Match frontend default
      sortField: body?.sortField || 'startDate',
      sortOrder: body?.sortOrder || 'desc'
    };

    // Construct the search query
    let query = new OSQuery(OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME, searchOptions);

    // Fuzzy search across all searchable fields
    if (userQuery) {
      query.addMatchQueryStringRule(userQuery);
    }

    // Structured filtering to apply exact matches for specific attributes
    const filters = {};

    if (body.email) {
      filters['namedOccupant.contactInfo.email.keyword'] = body.email;
    }

    // Calculate current time dynamically on the server
    const now = new Date().toISOString(); 
    // Fallback bounds for open-ended queries
    const past = '1970-01-01T00:00:00.000Z';
    const future = '2099-12-31T23:59:59.999Z';

    if (body.checkinStatus) {
      const status = body.checkinStatus.toLowerCase();

      if (status === 'reserved') {
        // checkInTime > now
        query.addRangeQueryRule('reservationContext.checkInTime', now, future, false, true);
        filters['status'] = 'confirmed';
      } 
      else if (status === 'active') {
        // checkInTime <= now AND checkOutTime >= now
        query.addRangeQueryRule('reservationContext.checkInTime', past, now, true, true);
        query.addRangeQueryRule('reservationContext.checkOutTime', now, future, true, true);
        filters['status'] = 'confirmed';
      } 
      else if (status === 'expired') {
        // checkOutTime < now
        query.addRangeQueryRule('reservationContext.checkOutTime', past, now, true, false);
        filters['status'] = 'confirmed';
      } 
      else if (status === 'cancelled') {
        filters['status'] = 'cancelled';
      }
    }

    if (Object.keys(filters).length > 0) {
      query.addFilterTermsRule(filters);
    }

    // Date range filtering (User's manual date filters)
    if (body.startDate || body.endDate) {
      query.addRangeQueryRule(
        'startDate', 
        body.startDate || '1970-01-01', 
        body.endDate || '2099-12-31'
      );
    }

    // Send the query to the OpenSearch cluster
    let response = await query.search();
    logger.debug("Request:", query.request); // Log the request (available after sending)
    logger.debug("Response:", response); // Log the response

    const isSuperAdmin = authContext?.permissions?.superadmin === "superadmin";
    if (response && isSuperAdmin) {
      response.body.hits.hits = response.body.hits.hits.map((hit) => {
        return hit._source
      });
    } else if (response && !isSuperAdmin) {
      // We want to remove hits where the user doesn't have the correct permissions
      response.body.hits.hits = response.body.hits.hits.filter((hit) => {
        const role = effectiveCollectionRole(
          authContext,
          hit._source.collectionId,
        );
        // For now, return for both limited and staff (TODO: this may change later)
        return role === "limited" || role === "staff";
      });

      // We also want to remove unneeded data attributes from the item (phone, address)
      // and restructure the response accordingly
      response.body.hits.hits = response.body.hits.hits.map((hit) => {
        const booking = hit._source;
        
        // Calculate party size
        const partySize = calculatePartySize(booking.partyInformation);

        return {
          // Core verification info only
          bookingId: booking?.bookingId,
          displayName: booking?.displayName,
          status: booking.status,
          bookingCompletionTime: booking?.bookingCompletionTime || booking?.bookedAt,
          
          // Dates (needed to verify reservation period)
          startDate: booking?.startDate,
          endDate: booking?.endDate,
          
          // Guest contact info
          firstName: booking?.firstName || booking?.namedOccupant?.firstName,
          lastName: booking?.lastName || booking?.namedOccupant?.lastName,
          email: booking?.email || booking?.namedOccupant?.contactInfo?.email,

          // Checked-in time (if it exists)
          checkedInTime: booking?.checkedInTime,

          // checkOutTime needed to calculate statuses (Active, Expired, etc.)
          reservationContext: {
            checkOutTime: booking?.reservationContext?.checkOutTime
          },

          // Party size only (not detailed age breakdown)
          partySize: partySize,
          partyInformation: booking?.partyInformation,
          
          // Location info (needed to verify correct park/activity)
          collectionId: booking?.collectionId,
          activityType: booking?.activityType,
          activitySubType: booking?.activitySubType,
          facilityDisplayName: booking?.facilityDisplayName,
          geozoneDisplayName: booking?.geozoneDisplayName,
          
          // Access points (if available, for trail/backcountry permits)
          entryPoint: booking?.entryPoint ? {
            text: booking.entryPoint.text,
            category: booking.entryPoint.category
          } : undefined,
          exitPoint: booking?.exitPoint ? {
            text: booking.exitPoint.text,
            category: booking.exitPoint.category
          } : undefined,
          location: booking?.location,
          
          // Vehicle info (if available, for parking passes)
          vehicleInformation: booking?.vehicleInformation,
        }
      });
    }

    // Send a success response
    return sendResponse(200, response.body.hits, "Success", null, context);
  } catch (err) {
    logger.error("Error in Bookings Admin Search POST:", err);
    return sendResponse(
      Number(err?.code) || 400,
      err?.data || null,
      err?.msg || "Error",
      err?.error || err,
      context,
    );
  }
};
