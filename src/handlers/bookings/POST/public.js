// Create new booking
const { Exception, logger, sendResponse, getRequestClaimsFromEvent, requestIdentity } = require("/opt/base");
const { createBooking, formatBookingResponsePublic, } = require("../methods");
const { batchTransactData, isTransactionConflict } = require("/opt/dynamodb");
const { parseAdmissionCookie, validateToken } = require('../../waiting-room/utils/token');
const { getHmacSigningKey } = require('../../waiting-room/utils/secrets');
const { getQueueMeta, buildQueueId } = require('../../waiting-room/utils/dynamodb');
const { refused } = require('../refusals');

exports.handler = async (event, context) => {
  logger.info("Bookings POST Activated", requestIdentity(event));

  // Declared out here so the catch can inspect which transaction item failed its
  // ConditionExpression (inventory sold out, or the booking-hold dedup marker).
  let bookingRequestItems;

  try {
    // Get the query time

    const queryTime = new Date().toISOString();

    // Get relevant data from the event

    let body;
    try {
      body = JSON.parse(event?.body);
    } catch {
      throw refused("invalid", "Body must be valid JSON");
    }
    if (!body) {
      throw refused("invalid", "Body is required");
    }

    const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId || body?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || body?.activityType;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || body?.activityId;
    const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId || body?.productId;
    const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate || body?.startDate;

    let endDate = event?.queryStringParameters?.endDate || body?.endDate;
    const quantity = parseInt(event?.queryStringParameters?.quantity || body?.quantity || '0', 10);

    if (!endDate) {
      endDate = startDate;
    }

    const claims = getRequestClaimsFromEvent(event);

    // Reject unauthenticated users - authentication required for booking creation
    if (!claims || !claims.sub) {
      throw refused("invalid", "Authentication required to create a booking", 401);
    }

    body['userId'] = claims.sub;
    body['endDate'] = endDate;

    // Validate required parameters
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!body.userId) missingParams.push("userId");
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");
    if (!startDate) missingParams.push("startDate");
    if (!productId) missingParams.push("productId");
    if (!quantity) missingParams.push("quantity");

    if (missingParams.length > 0) {
      throw refused("invalid", `Cannot create booking - missing required parameter(s): ${missingParams.join(", ")}`);
    }

    if (quantity < 1) {
      throw refused("invalid", `Invalid quantity: ${quantity}`);
    }

    // Waiting room enforcement — only when the table is configured
    if (process.env.WAITING_ROOM_TABLE_NAME && process.env.HMAC_SIGNING_KEY_ARN) {
      let waitingRoomActive = false;
      const facilityKey = `${collectionId}#${activityType}#${activityId}`;
      const queueId = buildQueueId(collectionId, activityType, activityId, startDate);

      try {
        const queueMeta = await getQueueMeta(queueId);
        waitingRoomActive = !!(queueMeta && queueMeta.queueStatus !== 'closed');
        if (!waitingRoomActive) {
          // Also check Mode 2 global queue
          const today = new Date().toISOString().slice(0, 10);
          const mode2QueueId = `QUEUE#MODE2#global#1#${today}`;
          const mode2Meta = await getQueueMeta(mode2QueueId);
          waitingRoomActive = !!(mode2Meta && mode2Meta.queueStatus !== 'closed');
        }
      } catch (err) {
        logger.warn('Failed to check waiting room status — failing open:', err);
      }

      if (waitingRoomActive) {
        const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
        const admissionToken = parseAdmissionCookie(cookieHeader);

        if (!admissionToken) {
          throw refused('waiting_room', 'Waiting room required for this booking', 403, { waitingRoom: true, queueId });
        }

        let hmacKey;
        try {
          hmacKey = await getHmacSigningKey();
        } catch (err) {
          logger.error('Failed to retrieve HMAC key for admission validation:', err);
          throw new Exception('Internal error validating admission', { code: 500 });
        }

        const admissionPayload = validateToken(admissionToken, hmacKey);

        if (!admissionPayload) {
          throw refused('waiting_room', 'Invalid or expired admission token', 403, { waitingRoom: true, queueId });
        }

        if (admissionPayload.sid !== claims.sub) {
          throw refused('waiting_room', 'Admission token does not match authenticated user', 403, { code: 'USER_MISMATCH' });
        }

        // Mode 2 tokens grant site-wide access — skip facility/date lock.
        // Exact match required; prefix check would allow any collectionId starting with 'MODE2'
        // to bypass facility/date enforcement.
        const isMode2Admission = admissionPayload.fk === 'MODE2#global#1';
        if (!isMode2Admission) {
          if (admissionPayload.fk !== facilityKey) {
            throw refused('waiting_room', 'Admission is locked to a different facility', 403, { code: 'FACILITY_MISMATCH' });
          }

          if (admissionPayload.dk !== startDate) {
            throw refused('waiting_room', 'Admission is locked to a different date', 403, { code: 'DATE_MISMATCH' });
          }
        }

        logger.info(`Admission validated for ${claims.sub} booking ${facilityKey}/${startDate}`);
      }
    }

    bookingRequestItems = await createBooking({
      ...body,
      collectionId,
      activityType,
      activityId,
      productId,
      startDate,
      endDate,
      invQuantity: quantity,
      userId: claims.sub,
    });

    const res = await batchTransactData(bookingRequestItems);

    const response = formatBookingResponsePublic(bookingRequestItems);

    // Note: the confirmation SMS is dispatched at booking completion, not here.
    // At create time the booking is not yet confirmed and the FE has not sent
    // the SMS opt-in (it arrives with the complete request). See the booking
    // complete handlers and methods.completeBooking().

    // event=<name> as the first token so a metric filter can match without
    // parsing prose. Success was previously only returned, never logged, so
    // holds could not be counted.
    const bookingItem = bookingRequestItems?.find((item) => item?.data?.Item?.schema?.S === "booking");
    logger.info("event=hold_created", {
      bookingId: bookingItem?.data?.Item?.bookingId?.S,
      userId: claims.sub,
    });

    return sendResponse(200, response, "Success", null, context);

  } catch (error) {
    logger.error("Booking creation error:", error);

    let errorMessage = '';
    let statusCode;
    let refusal = error?.data?.refusal || null;
    let lostWriteRace = isTransactionConflict(error);
    const cancellationReasons = error?.CancellationReasons || error?.cancellationReasons;

    if (error?.name === "TransactionCanceledException" && Array.isArray(cancellationReasons)) {
      cancellationReasons.forEach((reason, index) => {
        // Check if this specific transaction item failed its condition
        if (reason.Code === "ConditionalCheckFailed") {
          const itemObj = bookingRequestItems?.[index]?.data || bookingRequestItems?.[index];
          const item = itemObj?.Put?.Item || itemObj?.Update?.Key || itemObj?.Delete?.Key || itemObj?.Key || itemObj?.Item;
          const pkRaw = item?.pk?.S || item?.pk;
          const pk = typeof pkRaw === "string" ? pkRaw : "";

          if (pk.startsWith("bookinghold::")) {
            // Lost the atomic race with a concurrent create for the same
            // user/pass/date — same outcome as the sequential 409 guard.
            errorMessage = "You already have a booking for this pass. Cancel it before booking again.";
            statusCode = 409;
            refusal = "has_hold";
          } else if (pk.startsWith("inventoryPool::") || pk.startsWith("inventory::")) {
            errorMessage = "Booking item no longer available.";
            refusal = "sold_out";
          } else if (pk.startsWith("bookingDate::")) {
            errorMessage = "Error initializing the booking dates.";
            lostWriteRace = true;
          } else if (pk.startsWith("booking::")) {
            errorMessage = "Error creating the booking.";
            lostWriteRace = true;
          } else {
            errorMessage = "Transaction condition check failed.";
          }

          console.error(`Condition check failed on item index ${index} (${pk}): ${reason.Message || reason.Code}`);
        }
      });
    }

    if (isTransactionConflict(error)) {
      errorMessage = "This pass is in high demand right now. Please try again.";
      statusCode = 409;
    }

    if (lostWriteRace) {
      logger.warn("event=hold_conflict", { message: error?.message });
    } else if (refusal) {
      logger.info(`event=hold_refused_${refusal}`, {
        message: errorMessage || error?.message,
        existingBookingId: error?.data?.existingBookingId,
      });
    } else {
      logger.error("event=hold_failed", { message: errorMessage || error?.message });
    }

    const safeError = {
      name: error?.name,
      message: errorMessage || error?.message,
      code: error?.code,
      cancellationReasons: cancellationReasons || null,
    };

    return sendResponse(
      Number(error?.code) || statusCode || 400,
      error?.data || null,
      errorMessage || error?.message,
      safeError,
      context
    );
  }
};
