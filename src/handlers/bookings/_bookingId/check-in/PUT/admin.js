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
  flagCancelledBooking,
  generateEmailParams,
  sendBookingCancellationEmail,
} = require("../../../methods");

exports.handler = async (event, context) => {
  logger.info("Bookings Cancel POST:", event);

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
        adminUserId || "UNAUTHORIZED",
        bookingId || "unknown",
        "BOOKING-CHECK-IN-FAILED",
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
        "BOOKING-CHECK-IN-UNAUTHORIZED",
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

    // Check if booking status is confirmed (only status allowed)
    if (booking.status !== "confirmed") {
      await writeFailureAudit("Booking status is not confirmed", {
        status: booking.status,
        allowedStatuses: ["confirmed"],
      });

      logger.error("Status check failed", {
        bookingId,
        status: booking.status,
        allowedStatuses: ["confirmed"],
      });
      throw new Exception(
        `Booking has status "${booking.status}" and cannot be checked in`,
        { code: 400 },
      );
    }

    // Check if booking is already checked in, attribute shouldn't exist yet
    if (booking.checkedInTime) {
      await writeFailureAudit("Booking is already checked in", {
        checkedInTime: booking.checkedInTime,
      });

      throw new Exception(`Booking ${bookingId} is already checked in`, {
        code: 400,
      });
    }

    const queryTime = new Date().getTime();
    const scheduledCheckInTime = booking.reservationContext?.checkedInTime;
    const scheduledCheckOutTime = booking.reservationContext?.checkOutTime;
    const partySize = calculatePartySize(booking.partyInformation);

    // Confirm we're within check-in window
    if (scheduledCheckInTime && scheduledCheckInTime > queryTime) {
      await writeFailureAudit("Booking cannot be checked in before the scheduled time", {
        scheduledCheckInTime,
        queryTime,
      });

      const d = new Date(scheduledCheckInTime);
      const time = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const date = d.toISOString().split("T")[0];
      throw new Exception(
        `Booking ${bookingId} cannot be checked in until ${time} on ${date}`,
        {
          code: 400,
        },
      );
    }

    // Confirm we're not past the check-out time
    if (scheduledCheckOutTime && scheduledCheckOutTime < queryTime) {
      await writeFailureAudit("Booking cannot be checked in after the scheduled check-out time", {
        scheduledCheckOutTime,
        queryTime,
      });

      const d = new Date(scheduledCheckOutTime);
      const time = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const date = d.toISOString().split("T")[0];
      throw new Exception(
        `Booking ${bookingId} cannot be checked after ${time} on ${date}`,
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
    const expressionAttributeValues = {
      ":checkedInTime": { N: queryTime.toString() },
      ":checkedInByUser": { S: adminUserId },
    };

    let updateExpression =
      "SET #checkedInTime = :checkedInTime, #checkedInByUser = :checkedInByUser";
    const updateItem = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: {
        pk: { S: booking.pk },
        sk: { S: booking.sk },
      },
      UpdateExpression: updateExpression,
      ConditionExpression: "attribute_exists(#pk)",
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    // Write successful check-in to audit log
    await writeAuditLog(adminUserId, bookingId, 'BOOKING-CHECK-IN-SUCCESS', {
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

    logger.info(`Booking ${bookingId} checked in.`);

    return sendResponse(
      200,
      {
        message: "Booking checked in",
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
        "BOOKING-CHECK-IN-ERROR",
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

    logger.error("Error during check-in", {
      bookingId: event?.pathParameters?.bookingId,
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      stack: error?.stack,
    });

    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error checking in booking",
      error?.error || error,
      context,
    );
  }
};
