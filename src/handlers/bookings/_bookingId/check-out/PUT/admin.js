/**
 */
const {
  calculatePartySize,
  Exception,
  getRequestClaimsFromEvent,
  logger,
  sendResponse,
  writeAuditLog
} = require("/opt/base");
const {
  AUDIT_TABLE_NAME,
  batchTransactData,
  batchWriteData,
  marshall,
  TRANSACTIONAL_DATA_TABLE_NAME,
} = require("/opt/dynamodb");
const {
  getBookingByBookingId,
} = require("../../../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings Check-Out PUT:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    const bookingId = event?.pathParameters?.bookingId;
    const claims = getRequestClaimsFromEvent(event);
    const adminUserId = claims?.sub || null;
    const sourceIp = event.requestContext?.identity?.sourceIp || "unknown";
    const userAgent = event.requestContext?.identity?.userAgent || "unknown";

    const writeFailureAudit = async (reason, metadata = {}) => {
      await writeAuditLog(
        adminUserId,
        bookingId,
        "BOOKING-CHECK-OUT-FAILED",
        {
          reason,
          sourceIp,
          userAgent,
          ...metadata,
        },
        marshall,
        batchWriteData,
        AUDIT_TABLE_NAME,
      );
    };

    if (!adminUserId) {
      await writeAuditLog(
        "UNAUTHORIZED",
        bookingId || "unknown",
        "BOOKING-CHECK-OUT-UNAUTHORIZED",
        {
          reason: "Missing request claims",
          sourceIp,
          userAgent,
          hasToken: !!claims,
        },
        marshall,
        batchWriteData,
        AUDIT_TABLE_NAME,
      );

      throw new Exception("Unauthorized: User ID not found in request claims", {
        code: 401,
      });
    }

    const booking = await getBookingByBookingId(bookingId);

    // Check if booking status was checked in
    if (!booking.checkedInTime) {
      await writeFailureAudit("Booking status is not checked in yet");

      logger.error("Status check-out failed, user not checked-in", {
        bookingId
      });
      throw new Exception(
        "Booking has not been checked in yet",
        { code: 400 },
      );
    }

    const queryTime = new Date().getTime();
    const scheduledCheckInTime = booking.reservationContext?.checkInTime;
    const partySize = calculatePartySize(booking.partyInformation);

    // Get the calendar day (in Pacific Time)
    const currentDay = new Date(queryTime).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
    const scheduledDay = new Date(scheduledCheckInTime).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });

    // Confirm it is the same calendar day (allows late undos but prevents undos on entirely different days)
    if (currentDay !== scheduledDay) {
      await writeFailureAudit("Booking cannot be checked out on a different day", {
        scheduledCheckInTime: scheduledCheckInTime,
        queryTime,
      });

      throw new Exception(
        `Booking ${bookingId} can only be checked out (undone) on the same day as its reservation.`,
        {
          code: 400,
        },
      );
    }

    // Update item for batch transaction
    const expressionAttributeNames = {
      "#checkedInTime": "checkedInTime",
      "#checkedInByUser": "checkedInByUser",
      "#pk": "pk",
    };

    let updateExpression = "REMOVE #checkedInTime, #checkedInByUser";
    const updateItem = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: {
        pk: { S: booking.pk },
        sk: { S: booking.sk },
      },
      UpdateExpression: updateExpression,
      ConditionExpression: "attribute_exists(#pk)",
      ExpressionAttributeNames: expressionAttributeNames
    };

    // Write successful check-out to audit log
    await writeAuditLog(adminUserId, bookingId, 'BOOKING-CHECK-OUT-SUCCESS', {
      status: booking.status,
      partySize,
      collectionId: booking.collectionId,
      activityType: booking.activityType,
      startDate: booking.startDate,
      endDate: booking.endDate,
    }, marshall, batchWriteData, AUDIT_TABLE_NAME);

    await batchTransactData([
      {
        data: updateItem,
        action: "Update",
      },
    ]);

    logger.info(`Booking ${bookingId} checked out.`);

    return sendResponse(
      200,
      {
        message: "Booking checked out",
        bookingId,
      },
      "Success",
      null,
      context,
    );
  } catch (error) {
    if (error?.code !== 401) {
      await writeAuditLog(
        getRequestClaimsFromEvent(event)?.sub || "unknown",
        event?.pathParameters?.bookingId || "unknown",
        "BOOKING-CHECK-OUT-ERROR",
        {
          errorName: error?.name,
          errorMessage: error?.message,
          errorCode: error?.code,
        },
        marshall,
        batchWriteData,
        AUDIT_TABLE_NAME,
      );
    }

    logger.error("Error during check-out", {
      bookingId: event?.pathParameters?.bookingId,
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      stack: error?.stack,
    });

    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error checking out booking",
      error?.error || error,
      context,
    );
  }
};
