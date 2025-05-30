const crypto = require("crypto");
const { getOneByGlobalId, getByGSI, marshall, runQuery, TABLE_NAME } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { getActivityByActivityId } = require("/opt/activities/methods");

async function getBookingByBookingId(bookingId) {
  logger.debug("Getting booking by bookingId:", bookingId);
  try {
    return await getOneByGlobalId(bookingId);
  } catch (error) {
    throw new Exception("Error getting booking by bookingId", {
      code: 400,
      error: error,
    });
  }
}

async function getBookingsByUserSub(userSub) {
  logger.debug("Getting booking by userSub:", userSub);
  try {
    return await getByGSI("user", userSub, TABLE_NAME, "bookingUserSub-index");
  } catch (error) {
    throw new Exception("Error getting booking by userSub", {
      code: 400,
      error: error,
    });
  }
}

async function getBookingsByActivityDetails(acCollectionId, activityType, activityId, startDate = null, endDate = null) {
  logger.debug("Getting bookings by activity details:", acCollectionId, activityType, activityId, startDate, endDate);
  try {
    let query = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": marshall(`booking::${acCollectionId}::${activityType}::${activityId}`),
      },
    };

    if (startDate) {
      if (endDate) {
        // If both startDate and endDate are provided, get everything in between
        // We can use >= for startDate on the sk since it begins with the startDate - this is better for scalability.
        query.KeyConditionExpression += " AND sk >= :startDate";
        query['FilterExpression'] = "endDate <= :endDate";
        query.ExpressionAttributeValues[":startDate"] = marshall(startDate);
        query.ExpressionAttributeValues[":endDate"] = marshall(endDate);
      } else {
        // If only startDate is provided, use begins_with to only get booking that start on the startDate
        query.KeyConditionExpression += " AND begins_with(sk, :startDate)";
        query.ExpressionAttributeValues[":startDate"] = marshall(startDate);
      }
    }

    logger.debug("Querying bookings:", query);
    const result = await runQuery(query);
    logger.debug("Bookings result:", result);
    return result;

  } catch (error) {
    throw new Exception("Error getting bookings by activity details", {
      code: 400,
      error: error,
    });
  }
}

async function createBooking(acCollectionId, activityType, activityId, startDate, body) {
  logger.debug("Creating booking:", acCollectionId, activityType, activityId, startDate, body);
  try {

    // Confirm that activity exists
    const activity = await getActivityByActivityId(acCollectionId, activityType, activityId);

    if (!activity) {
      throw new Exception(`Activity not found (CollectionID: ${acCollectionId}, Type: ${activityType}, ID: ${activityId}`, { code: 404 });
    }

    // Create unique bookingId
    const globalId = crypto.randomUUID();

    // Create booking request
    let bookingRequest = {
      ...body,
      pk: `booking::${acCollectionId}::${activityType}::${activityId}`,
      sk: `${startDate}::${globalId}`,
      schema: "booking",
      globalId: globalId,
      bookingId: globalId,
      activityType: activityType,
      activityId: activityId,
      acCollectionId: acCollectionId,
      startDate: startDate,
    };

    // TODO: change later to potentially support bulk bookings
    return [{
      key: {
        pk: bookingRequest.pk,
        sk: bookingRequest.sk,
      },
      data: bookingRequest,
    }];

  } catch (error) {
    throw new Exception("Error creating booking", {
      code: 400,
      error: error,
    });
  }
}

module.exports = {
  createBooking,
  getBookingsByActivityDetails,
  getBookingByBookingId,
  getBookingsByUserSub
}

