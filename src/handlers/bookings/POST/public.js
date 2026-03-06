// Create new booking
const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { createBooking } = require("../methods");
const { BOOKING_PUT_CONFIG } = require("../configs");
const { quickApiPutHandler } = require("../../../common/data-utils");
const { TRANSACTIONAL_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");
const { parseAdmissionCookie, validateToken } = require('../../waiting-room/utils/token');
const { getHmacSigningKey } = require('../../waiting-room/utils/secrets');
const { getQueueMeta, buildQueueId } = require('../../waiting-room/utils/dynamodb');

exports.handler = async (event, context) => {
  logger.info("Bookings POST:", event);

  try {
    // Get relevant data from the event

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

  const collectionId = event?.pathParameters?.collectionId || event?.queryStringParameters?.collectionId || body?.collectionId;
  const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || body?.activityType;
  const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || body?.activityId;
  const startDate = event?.pathParameters?.startDate || event?.queryStringParameters?.startDate || body?.startDate;

  const claims = getRequestClaimsFromEvent(event);
  
  // Reject unauthenticated users - authentication required for booking creation
  if (!claims || !claims.sub) {
    throw new Exception("Authentication required to create a booking", { code: 401 });
  }
  
  body['userId'] = claims.sub;

    // Validate required parameters
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!body.userId) missingParams.push("userId");
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");
    if (!startDate) missingParams.push("startDate");

    if (missingParams.length > 0) {
      throw new Exception(
        `Cannot create booking - missing required parameter(s): ${missingParams.join(", ")}`,
        { code: 400 }
      );
    }

    // Waiting room enforcement — only when the table is configured
    if (process.env.WAITING_ROOM_TABLE_NAME && process.env.HMAC_SIGNING_KEY_ARN) {
      let waitingRoomActive = false;
      const facilityKey = `${collectionId}#${activityType}#${activityId}`;
      const queueId = buildQueueId(collectionId, activityType, activityId, startDate);

      try {
        const queueMeta = await getQueueMeta(queueId);
        waitingRoomActive = !!(queueMeta && queueMeta.queueStatus !== 'closed');
      } catch (err) {
        logger.warn('Failed to check waiting room status — failing open:', err);
      }

      if (waitingRoomActive) {
        const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
        const admissionToken = parseAdmissionCookie(cookieHeader);

        if (!admissionToken) {
          throw new Exception('Waiting room required for this booking', {
            code: 403,
            data: { waitingRoom: true, queueId },
          });
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
          throw new Exception('Invalid or expired admission token', {
            code: 403,
            data: { waitingRoom: true, queueId },
          });
        }

        if (admissionPayload.sid !== claims.sub) {
          throw new Exception('Admission token does not match authenticated user', {
            code: 403,
            data: { code: 'USER_MISMATCH' },
          });
        }

        // Mode 2 tokens grant site-wide access — skip facility/date lock.
        // Exact match required; prefix check would allow any collectionId starting with 'MODE2'
        // to bypass facility/date enforcement.
        const isMode2Admission = admissionPayload.fk === 'MODE2#global#1';
        if (!isMode2Admission) {
          if (admissionPayload.fk !== facilityKey) {
            throw new Exception('Admission is locked to a different facility', {
              code: 403,
              data: { code: 'FACILITY_MISMATCH' },
            });
          }

          if (admissionPayload.dk !== startDate) {
            throw new Exception('Admission is locked to a different date', {
              code: 403,
              data: { code: 'DATE_MISMATCH' },
            });
          }
        }

        logger.info(`Admission validated for ${claims.sub} booking ${facilityKey}/${startDate}`);
      }
    }

    let postRequests = await createBooking(collectionId, activityType, activityId, startDate, body);

    const putItems = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      postRequests,
      BOOKING_PUT_CONFIG
    );

    const res = await batchTransactData(putItems);

    const response = {
      res: res,
      booking: postRequests,
    }

    return sendResponse(200, response, "Success", null, context);

  } catch (error) {
    logger.error("Booking creation error:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message,
      error?.error || error,
      context
    );
  }
}
