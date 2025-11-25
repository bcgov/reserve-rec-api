const crypto = require("crypto");
const {
  getOneByGlobalId,
  getByGSI,
  marshall,
  runQuery,
  TRANSACTIONAL_DATA_TABLE_NAME,
  USERID_INDEX_NAME,
  USERID_PROPERTY_NAME,
} = require("/opt/dynamodb");
const { snsPublishCommand, snsPublishSend } = require("/opt/sns");
const { Exception, logger } = require("/opt/base");
const {
  getActivityByActivityId,
  getActivitiesByCollectionId,
} = require("../activities/methods");
const { getAndAttachNestedProperties } = require("../../common/data-utils");
const { DateTime } = require("luxon");

async function getBookingsByUserId(userId, props) {
  logger.debug("Getting booking by userId:", userId);
  try {
    let params = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      IndexName: USERID_INDEX_NAME,
      KeyConditionExpression: "#userId = :userId",
      ExpressionAttributeNames: {
        "#userId": USERID_PROPERTY_NAME,
      },
      ExpressionAttributeValues: {
        ":userId": marshall(userId),
      },
    };

    let filterExpression = "";

    if (props?.bookingId) {
      filterExpression = "bookingId = :bookingId";
      params.ExpressionAttributeValues[":bookingId"] = marshall(props.bookingId);
    }
    if (props?.startDate) {
      filterExpression = (filterExpression ? filterExpression + " AND " : "") + "startDate >= :startDate";
      params.ExpressionAttributeValues[":startDate"] = marshall(props.startDate);
    }
    if (props?.endDate) {
      filterExpression = (filterExpression ? filterExpression + " AND " : "") + "endDate <= :endDate";
      params.ExpressionAttributeValues[":endDate"] = marshall(props.endDate);
    }

    // Only add FilterExpression if it's not empty
    if (filterExpression) {
      params.FilterExpression = filterExpression;
    }

    const result = await runQuery(params);
    return result;

  } catch (error) {
    throw new Exception(`Error getting booking by userId: ${error}`);
  }
}

async function getBookingByBookingId(bookingId, userId = null, fetchAccessPoints = false) {
  logger.debug("Getting booking by bookingId:", bookingId);
  try {
    let data = await getOneByGlobalId(bookingId, TRANSACTIONAL_DATA_TABLE_NAME);
    if (fetchAccessPoints) {
      console.debug("Fetching access points for booking:", bookingId);
      await getAndAttachNestedProperties(data, ["entryPoint", "exitPoint"]);
    }
    return data;
  } catch (error) {
    throw new Exception("Error getting booking by bookingId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

async function getBookingsByActivityDetails(
  collectionId,
  activityType,
  activityId,
  startDate = null,
  endDate = null,
  limit = null,
  lastEvaluatedKey = null
) {
  logger.debug(
    "Getting bookings by activity details:",
    collectionId,
    activityType,
    activityId,
    startDate,
    endDate,
    limit,
    lastEvaluatedKey
  );
  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": marshall(
          `booking::${collectionId}::${activityType}::${activityId}`
        ),
      },
    };

    if (startDate) {
      if (endDate) {
        query.KeyConditionExpression += " AND sk >= :startDate";
        query["FilterExpression"] = "endDate <= :endDate";
        query.ExpressionAttributeValues[":startDate"] = marshall(startDate);
        query.ExpressionAttributeValues[":endDate"] = marshall(endDate);
      } else {
        query.KeyConditionExpression += " AND begins_with(sk, :startDate)";
        query.ExpressionAttributeValues[":startDate"] = marshall(startDate);
      }
    }

    // Add pagination
    if (limit) {
      query.Limit = limit;
    }

    if (lastEvaluatedKey) {
      query.ExclusiveStartKey = lastEvaluatedKey;
    }

    logger.debug("Querying bookings:", query);
    const result = await runQuery(query);
    logger.debug("Bookings result:", result);

    return {
      items: result.items || result,
      lastEvaluatedKey: result.LastEvaluatedKey || null,
    };
  } catch (error) {
    throw new Exception("Error getting bookings by activity details", {
      code: 400,
      error: error,
    });
  }
}

async function createBooking(
  collectionId,
  activityType,
  activityId,
  startDate,
  body
) {
  logger.debug(
    "Creating booking:",
    collectionId,
    activityType,
    activityId,
    startDate,
    body
  );
  try {
    // Confirm that activity exists
    const activity = await getActivityByActivityId(
      collectionId,
      activityType,
      activityId
    );

    if (!activity) {
      throw new Exception(
        `Activity not found (CollectionID: ${collectionId}, Type: ${activityType}, ID: ${activityId}`,
        { code: 404 }
      );
    }

    // Create unique bookingId
    const globalId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    // Create booking request
    let bookingRequest = {
      ...body,
      pk: `booking::${collectionId}::${activityType}::${activityId}`,
      sk: `${startDate}::${globalId}`,
      schema: "booking",
      globalId: globalId,
      bookingId: globalId,
      activityType: activityType,
      activityId: activityId,
      collectionId: collectionId,
      startDate: startDate,
      bookingStatus: "in progress",
      sessionId: sessionId,
    };

    // TODO: change later to potentially support bulk bookings
    return [
      {
        key: {
          pk: bookingRequest.pk,
          sk: bookingRequest.sk,
        },
        data: bookingRequest,
      },
    ];
  } catch (error) {
    throw new Exception("Error creating booking", {
      code: 400,
      error: error,
    });
  }
}

async function completeBooking(bookingId, sessionId, clientTransactionId) {
  try {
    const booking = await getBookingByBookingId(bookingId);
    console.log("booking: ", booking);

    // If the booking isn't 'in progress', we cannot alter it.
    if (booking.bookingStatus !== "in progress") {
      throw new Exception(`Booking cannot be altered at this state.`, {
        code: 400,
      });
    }

    // If the booking doesn't have the same session ID, then we fail
    if (booking.sessionId !== sessionId) {
      throw new Exception(`Booking cannot be altered at this state.`, {
        code: 400,
      });
    }

    // Set the booking as complete and return the putItem
    return {
      key: { pk: booking.pk, sk: booking.sk },
      data: { 
        bookingStatus: "confirmed",
        clientTransactionId: clientTransactionId,
       },
    };
  } catch (error) {
    throw new Exception("Error updating booking", {
      code: 400,
      error: error,
    });
  }
}

async function cancelBooking(bookingId, userId, reason = null) {
  try {
    const booking = await getBookingByBookingId(bookingId);

    // Verify ownership
    if (booking.userId !== userId) {
      throw new Exception(`User ${userId} does not own booking ${bookingId}`, {
        code: 403,
      });
    }

    // Check if already cancelled
    if (booking.bookingStatus === "cancelled") {
      throw new Exception(`Booking ${bookingId} is already cancelled`, {
        code: 400,
      });
    }

    // Return the putItem for cancellation
    return {
      key: { pk: booking.pk, sk: booking.sk },
      data: {
        bookingStatus: "cancelled",
        cancellationReason: reason || "Customer requested cancellation",
        cancelledAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw new Exception("Error cancelling booking", {
      code: 400,
      error: error,
    });
  }
}

/**
 * GET /bookings/admin handler helper functions
 */

/*
 * Validates admin userId requirements
 */
function validateAdminRequirements(userObject, collectionId) {
  if (userObject.isAdmin && !collectionId) {
    throw new Exception("collectionId is required for Admin users", {
      code: 400,
    });
  }
}

/*
 * Calculates effective date range based on userId type and provided dates
 */
function calculateDateRange(userObject, startDate, endDate) {
  let effectiveStartDate, effectiveEndDate;

  if (userObject.isAdmin) {
    // Admin logic consideration: limit to 30 days ago by default, max 90 days range
    // Prevent admin from slamming a huge data pull
    const defaultStart = DateTime.now().minus({ days: 30 }).toISODate();
    effectiveStartDate = startDate || defaultStart;
    effectiveEndDate = DateTime.fromISO(effectiveStartDate)
      .plus({ days: 90 })
      .toISODate();
  } else {
    // Non-admin logic: startDate is 90 days ago up 1 year in future unless otherwise specified
    effectiveStartDate =
      startDate || DateTime.now().minus({ days: 90 }).toISODate();
    effectiveEndDate =
      endDate ||
      DateTime.fromISO(effectiveStartDate).plus({ years: 1 }).toISODate();
  }

  return { effectiveStartDate, effectiveEndDate };
}

/*
 * Validates the provided date range
 */
function validateDateRange(startDate, endDate, isAdmin) {
  if (
    isAdmin &&
    DateTime.fromISO(startDate) < DateTime.now().minus({ days: 31 })
  ) {
    throw new Exception(
      "Admin startDate cannot be more than 30 days in the past",
      {
        code: 400,
      }
    );
  }
  if (
    isAdmin &&
    DateTime.fromISO(endDate) > DateTime.fromISO(startDate).plus({ days: 91 })
  ) {
    throw new Exception("Admin endDate range cannot exceed 90 days", {
      code: 400,
    });
  }
}

/*
 * Builds activity filters from query parameters
 */
function buildActivityFilters(activityType, activityId) {
  const filters = {};
  if (activityType) filters.activityType = activityType;
  if (activityId) filters.activityId = activityId;
  return filters;
}

/*
 * Validates user access to the specified collection
 */
function validateCollectionAccess(collections, userObject) {
  for (const collectionId of collections) {
    if (!userObject.isAdmin && !userObject.collection.includes(collectionId)) {
      throw new Exception(
        `user does not have access to collection ${collectionId}`,
        {
          code: 403,
        }
      );
    }
  }
}

/*
 * Fetches all activities for the given collections and filters
 */
async function fetchAllActivities(collections, filters) {
  const allActivities = [];

  logger.debug("Collections to check:", collections);

  for (const collection of collections) {
    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });
    allActivities.push(...activities.items);
  }

  logger.debug("Activities to check:", allActivities);
  return allActivities;
}

/**
 * Sorts and paginates all bookings
 */
function allBookingsSortAndPaginate(
  allBookings,
  limit,
  nextPageKey,
  sortOrder
) {
  // Sort by collectionId first, then by startDate within each collection
  allBookings.sort((a, b) => {
    const collectionComparison =
      sortOrder === "desc"
        ? b.collectionId.localeCompare(a.collectionId)
        : a.collectionId.localeCompare(b.collectionId);

    if (collectionComparison !== 0) {
      return collectionComparison;
    }

    // Within same collection, sort by startDate
    const dateA = new Date(a.startDate);
    const dateB = new Date(b.startDate);
    return dateA - dateB;
  });

  return {
    items: allBookings.slice(0, limit),
    lastEvaluatedKey: nextPageKey,
  };
}

/*
 * Fetches all bookings with pagination and sorting
 */
async function fetchBookingsWithPagination(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit = 20,
  lastEvaluatedKey = null,
  sortOrder = "asc",
  sortBy = "startDate"
) {
  // Handle different sorting strategies as per the user's request
  switch (sortBy) {
    case "collectionId":
      return await fetchBookingsSortedByCollection(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder
      );
    case "activityType":
    case "activityId":
      return await fetchBookingsSortedByActivity(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder,
        sortBy
      );
    case "startDate":
    case "endDate":
      return await fetchBookingsSortedByDate(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder,
        sortBy
      );
    default:
      // Otherwise default to startDate sorting
      return await fetchBookingsSortedByDate(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder,
        "startDate"
      );
  }
}

/**
 * Fetch bookings sorted by collectionId
 */
async function fetchBookingsSortedByCollection(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit,
  lastEvaluatedKey,
  sortOrder
) {
  let currentCollectionIndex = 0;
  let lastBookingDate = null;
  let lastBookingId = null;

  // Check for pagination state from lastEvaluatedKey if passed in
  logger.debug("lastEvaluatedKey: ", lastEvaluatedKey);
  if (lastEvaluatedKey && lastEvaluatedKey.sortBy === "collectionId") {
    currentCollectionIndex = lastEvaluatedKey.collectionIndex || 0;
    lastBookingDate = lastEvaluatedKey.lastBookingDate;
    lastBookingId = lastEvaluatedKey.lastBookingId;
  }

  // Sort collections by prefix ("bcparks_") and then by number ("_123")
  const sortedCollections = [...collections].sort((a, b) => {
    const [prefixA, numA] = a.split("_");
    const [prefixB, numB] = b.split("_");

    if (prefixA !== prefixB) {
      return sortOrder === "desc"
        ? prefixB.localeCompare(prefixA)
        : prefixA.localeCompare(prefixB);
    }

    const diff = parseInt(numA, 10) - parseInt(numB, 10);
    return sortOrder === "desc" ? -diff : diff;
  });

  // Start going through the collections starting from currentCollectionIndex (or 0)
  for (
    let collectionIdx = currentCollectionIndex;
    collectionIdx < sortedCollections.length;
    collectionIdx++
  ) {
    const collection = sortedCollections[collectionIdx];
    const collectionBookings = [];

    // Get all the activities for this collection based on filters (if passed in)
    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });

    // Get all the bookings from all the activities in the collection
    for (const activity of activities.items) {
      const bookings = await getBookingsByActivityDetails(
        activity.collectionId,
        activity.activityType,
        activity.activityId,
        effectiveStartDate,
        effectiveEndDate,
        null,
        null
      );

      collectionBookings.push(...bookings.items);
    }
    logger.debug("collectionBookings: ", collectionBookings);

    // We default sort all bookings in the collection by startDate
    collectionBookings.sort((a, b) => {
      const dateA = new Date(a.startDate);
      const dateB = new Date(b.startDate);
      const comparison = dateA - dateB;

      return comparison;
    });

    // If we're picking up from a lastEvaluatedKey, find where to start
    let startIndex = 0;
    if (
      collectionIdx === currentCollectionIndex &&
      lastBookingDate &&
      lastBookingId
    ) {
      // Find the position after the last returned booking
      for (let i = 0; i < collectionBookings.length; i++) {
        const booking = collectionBookings[i];
        if (
          booking.startDate === lastBookingDate &&
          booking.globalId === lastBookingId
        ) {
          startIndex = i + 1;
          break;
        }
      }
    }

    // Slice the bookings to start from the correct position
    const availableBookings = collectionBookings.slice(startIndex);

    // Track the number of bookings we've collected against the limit provided
    if (availableBookings.length >= limit) {
      const items = availableBookings.slice(0, limit);

      // Create a nextPageKey to point to the last booking we returned
      // This will be used for lastEvaluatedKey in the next request
      const lastItem = items[items.length - 1];
      const nextPageKey = {
        sortBy: "collectionId",
        collectionIndex: collectionIdx,
        lastBookingDate: lastItem.startDate,
        lastBookingId: lastItem.globalId,
        collectionId: collection,
      };

      return {
        items: items,
        lastEvaluatedKey: nextPageKey,
      };
    }

    // If we don't have enough bookings in this collection, but have some
    if (availableBookings.length > 0) {
      // Check if there are more collections to go through
      if (collectionIdx + 1 < sortedCollections.length) {
        // Return what we have and the nextPageKey for the next collection
        const nextPageKey = {
          sortBy: "collectionId",
          collectionIndex: collectionIdx + 1,
          lastBookingDate: null,
          lastBookingId: null,
          collectionId: sortedCollections[collectionIdx + 1],
        };

        return {
          items: availableBookings.slice(0, limit),
          lastEvaluatedKey: nextPageKey,
        };
      } else {
        // Last collection, return what we have
        return {
          items: availableBookings.slice(0, limit),
          lastEvaluatedKey: null,
        };
      }
    }
  }

  // No more collections or bookings, return empty
  return {
    items: [],
    lastEvaluatedKey: null,
  };
}

/**
 * Fetch bookings sorted by activityType or activityId
 */
async function fetchBookingsSortedByActivity(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit,
  lastEvaluatedKey,
  sortOrder,
  sortBy
) {
  let currentCollectionIndex = 0;
  let currentActivityIndex = 0;
  let activityLastKey = null;

  // Check for pagination state from lastEvaluatedKey if passed in
  if (lastEvaluatedKey && lastEvaluatedKey.sortBy === sortBy) {
    currentCollectionIndex = lastEvaluatedKey.collectionIndex || 0;
    currentActivityIndex = lastEvaluatedKey.activityIndex || 0;
    activityLastKey = lastEvaluatedKey.activityLastKey;
  }

  // Sort collections by prefix ("bcparks_") and then by number ("_123")
  const sortedCollections = [...collections].sort((a, b) => {
    const [prefixA, numA] = a.split("_");
    const [prefixB, numB] = b.split("_");

    if (prefixA !== prefixB) {
      return sortOrder === "desc"
        ? prefixB.localeCompare(prefixA)
        : prefixA.localeCompare(prefixB);
    }

    const diff = parseInt(numA, 10) - parseInt(numB, 10);
    return sortOrder === "desc" ? -diff : diff;
  });

  const collectedBookings = [];

  // Go through each collection starting from currentCollectionIndex (or 0)
  for (
    let collectionIdx = currentCollectionIndex;
    collectionIdx < sortedCollections.length;
    collectionIdx++
  ) {
    const collection = sortedCollections[collectionIdx];

    // Get all the activities for this collection
    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });

    // Sort the activities by type or id - this determines our fetch order
    activities.items.sort((a, b) => {
      let comparison;
      if (sortBy === "activityType") {
        comparison =
          sortOrder === "desc"
            ? b.activityType.localeCompare(a.activityType)
            : a.activityType.localeCompare(b.activityType);

        // Sort by activityId if same type
        if (comparison === 0) {
          return Number(a.activityId) - Number(b.activityId);
        }
      } else if (sortBy === "activityId") {
        comparison =
          sortOrder === "desc"
            ? Number(b.activityId) - Number(a.activityId)
            : Number(a.activityId) - Number(b.activityId);
      }
      return comparison;
    });

    // Determine where to start in the activities list
    const startActivityIdx =
      collectionIdx === currentCollectionIndex ? currentActivityIndex : 0;

    // Fetch bookings from activities in sorted order until we have enough
    for (
      let activityIdx = startActivityIdx;
      activityIdx < activities.items.length;
      activityIdx++
    ) {
      const activity = activities.items[activityIdx];

      // Use the activityLastKey only if we're resuming from the exact same activity
      const lastKey =
        collectionIdx === currentCollectionIndex &&
        activityIdx === currentActivityIndex
          ? activityLastKey
          : null;

      // Fetch bookings from this activity with pagination
      // DynamoDB naturally sorts by startDate due to our sort key structure
      const bookings = await getBookingsByActivityDetails(
        activity.collectionId,
        activity.activityType,
        activity.activityId,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastKey
      );

      collectedBookings.push(...bookings.items);

      // If we have enough bookings or this activity has more data
      if (collectedBookings.length >= limit || bookings.lastEvaluatedKey) {
        // Sort what we have collected so far by activity field, then by date
        // This ensures proper ordering across activities
        collectedBookings.sort((a, b) => {
          let comparison;
          if (sortBy === "activityType") {
            comparison =
              sortOrder === "desc"
                ? b.activityType.localeCompare(a.activityType)
                : a.activityType.localeCompare(b.activityType);

            // Secondary sort by activityId, then startDate
            if (comparison === 0) {
              const idComparison = Number(a.activityId) - Number(b.activityId);
              if (idComparison === 0) {
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateA - dateB;
              }
              return idComparison;
            }
          } else if (sortBy === "activityId") {
            comparison =
              sortOrder === "desc"
                ? Number(b.activityId) - Number(a.activityId)
                : Number(a.activityId) - Number(b.activityId);

            // Secondary sort by activityType, then startDate
            if (comparison === 0) {
              const typeComparison = a.activityType.localeCompare(
                b.activityType
              );
              if (typeComparison === 0) {
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateA - dateB;
              }
              return typeComparison;
            }
          }
          return comparison;
        });

        const items = collectedBookings.slice(0, limit);

        // Create next page key to track our position
        let nextPageKey = null;
        if (bookings.lastEvaluatedKey) {
          // More bookings in current activity
          nextPageKey = {
            sortBy: sortBy,
            collectionIndex: collectionIdx,
            activityIndex: activityIdx,
            activityLastKey: bookings.lastEvaluatedKey,
            collectionId: collection,
            activityType: activity.activityType,
            activityId: activity.activityId,
          };
        } else if (activityIdx + 1 < activities.items.length) {
          // More activities in current collection
          nextPageKey = {
            sortBy: sortBy,
            collectionIndex: collectionIdx,
            activityIndex: activityIdx + 1,
            activityLastKey: null,
            collectionId: collection,
            activityType: activities.items[activityIdx + 1].activityType,
            activityId: activities.items[activityIdx + 1].activityId,
          };
        } else if (collectionIdx + 1 < sortedCollections.length) {
          // More collections
          nextPageKey = {
            sortBy: sortBy,
            collectionIndex: collectionIdx + 1,
            activityIndex: 0,
            activityLastKey: null,
            collectionId: sortedCollections[collectionIdx + 1],
            activityType: null,
            activityId: null,
          };
        }

        return {
          items: items,
          lastEvaluatedKey:
            collectedBookings.length >= limit ? nextPageKey : null,
        };
      }
    }
  }

  // Final sort for any remaining results (when we've processed all collections)
  collectedBookings.sort((a, b) => {
    let comparison;
    if (sortBy === "activityType") {
      comparison =
        sortOrder === "desc"
          ? b.activityType.localeCompare(a.activityType)
          : a.activityType.localeCompare(b.activityType);

      // Secondary sort by activityId, then startDate
      if (comparison === 0) {
        const idComparison = Number(a.activityId) - Number(b.activityId);
        if (idComparison === 0) {
          const dateA = new Date(a.startDate);
          const dateB = new Date(b.startDate);
          return dateA - dateB;
        }
        return idComparison;
      }
    } else if (sortBy === "activityId") {
      comparison =
        sortOrder === "desc"
          ? Number(b.activityId) - Number(a.activityId)
          : Number(a.activityId) - Number(b.activityId);

      // Secondary sort by activityType, then startDate
      if (comparison === 0) {
        const typeComparison = a.activityType.localeCompare(b.activityType);
        if (typeComparison === 0) {
          const dateA = new Date(a.startDate);
          const dateB = new Date(b.startDate);
          return dateA - dateB;
        }
        return typeComparison;
      }
    }
    return comparison;
  });

  // Return what we have with no next page key
  return {
    items: collectedBookings.slice(0, limit),
    lastEvaluatedKey: null,
  };
}

/**
 * Fetch bookings sorted by startDate or endDate
 */
async function fetchBookingsSortedByDate(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit,
  lastEvaluatedKey,
  sortOrder,
  sortBy
) {
  const allBookings = [];
  let targetDate = null;
  let targetId = null;
  let foundCursor = false;

  // Parse pagination state
  if (lastEvaluatedKey && lastEvaluatedKey.sortBy === sortBy) {
    targetDate = lastEvaluatedKey.lastItemDate;
    targetId = lastEvaluatedKey.lastItemId;
  }

  // Adjust date filter based on cursor for better efficiency
  let adjustedStartDate = effectiveStartDate;
  let adjustedEndDate = effectiveEndDate;

  if (targetDate) {
    if (sortOrder === "asc") {
      // For ascending order, start from the target date
      adjustedStartDate = targetDate;
    } else {
      // For descending order, end at the target date
      adjustedEndDate = targetDate;
    }
  }

  // Fetch from all collections
  for (
    let collectionIdx = 0;
    collectionIdx < collections.length;
    collectionIdx++
  ) {
    const collection = collections[collectionIdx];

    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });

    activities.items.sort((a, b) => {
      if (a.activityType !== b.activityType) {
        return a.activityType.localeCompare(b.activityType);
      }
      return Number(a.activityId) - Number(b.activityId);
    });

    for (
      let activityIdx = 0;
      activityIdx < activities.items.length;
      activityIdx++
    ) {
      const activity = activities.items[activityIdx];

      const bookings = await getBookingsByActivityDetails(
        activity.collectionId,
        activity.activityType,
        activity.activityId,
        adjustedStartDate,
        adjustedEndDate,
        null,
        null
      );

      // Filter bookings based on cursor position
      for (const booking of bookings.items) {
        if (targetDate && targetId) {
          const bookingDate = new Date(booking[sortBy]);
          const cursorDate = new Date(targetDate);

          if (sortOrder === "asc") {
            // Skip items until we're past the cursor
            if (
              bookingDate < cursorDate ||
              (bookingDate.getTime() === cursorDate.getTime() &&
                booking.globalId <= targetId)
            ) {
              continue;
            }
          } else {
            // Skip items until we're past the cursor (going backwards)
            if (
              bookingDate > cursorDate ||
              (bookingDate.getTime() === cursorDate.getTime() &&
                booking.globalId >= targetId)
            ) {
              continue;
            }
          }
        }

        allBookings.push(booking);
      }
    }
  }

  // Sort the collected bookings
  allBookings.sort((a, b) => {
    const dateA = new Date(a[sortBy]);
    const dateB = new Date(b[sortBy]);

    const comparison = sortOrder === "desc" ? dateB - dateA : dateA - dateB;

    if (comparison === 0) {
      return a.globalId.localeCompare(b.globalId);
    }
    return comparison;
  });

  // Get only the requested limit
  const items = allBookings.slice(0, limit);

  // Determine if there are more results to be passed as hasMore
  const hasMore = allBookings.length > limit;
  const nextPageKey =
    hasMore && items.length > 0
      ? {
          sortBy: sortBy,
          lastItemDate: items[items.length - 1][sortBy],
          lastItemId: items[items.length - 1].globalId,
          collectionIndex: 0,
          activityIndex: 0,
        }
      : null;

  return {
    items: items,
    lastEvaluatedKey: nextPageKey,
  };
}

/**
  * Publishes booking cancellation command to SNS
  * @param {object} booking - The ID of the booking to cancel
  * @param {string} booking.bookingId - The ID of the booking to cancel
  * @param {string} booking.userId - The userId identifier requesting the cancellation
  * @param {string} booking.clientTransactionId - The client transaction ID associated with the booking
  * @param {object} booking.feeInformation - The fee information associated with the booking
  * @param {string} reason - The reason for cancellation
  */
async function cancellationPublishCommand(booking, reason) {
  // Prepare cancellation message
  const cancellationMessage = {
    bookingId: booking.bookingId,
    userId: booking.userId,
    clientTransactionId: booking.clientTransactionId,
    refundAmount: booking.feeInformation?.total || 0, // TODO: adjust based on cancellation policy
    reason: reason || 'Cancelled by user via self-serve',
    timestamp: new Date().toISOString(),
  };

  const messageAttributes = {
    eventType: {
      DataType: 'String',
      StringValue: 'BOOKING_CANCELLATION',
    },
    bookingId: {
      DataType: 'String',
      StringValue: booking.bookingId,
    },
  };

  // Publish to SNS topic to trigger cancellation workflow
  const publishCommand = snsPublishCommand(
    process.env.BOOKING_NOTIFICATION_TOPIC_ARN,
    cancellationMessage,
    `Booking Cancellation: ${booking.bookingId}`,
    {}
  );

  const result = await snsPublishSend(publishCommand);

  return result;
}

/**
  * Publishes transaction command to SNS
  * @param {object} booking - The ID of the booking to cancel
  *   @param {string} booking.bookingId - The ID of the booking to cancel
  *   @param {string} booking.userId - The userId identifier requesting the cancellation
  *   @param {string} booking.clientTransactionId - The client transaction ID associated with the booking
  *   @param {object} booking.feeInformation - The fee information associated with the booking
  * @param {string} reason - The reason for cancellation
  */
async function refundPublishCommand(booking, reason) {

  // TODO: trnAmount calculation based on booking details
  // const trnAmount = calculateRefundAmount(booking);
  
  // Publish to refund topic if there's a transaction
  const refundMessage = {
    clientTransactionId: booking.clientTransactionId,
    bookingId: booking.bookingId,
    userId: booking.userId,
    refundAmount: booking.feeInformation?.total || 0, // TODO: adjust based on cancellation policy
    reason: booking.cancellationReason || reason || 'Cancelled by user via self-serve',
  };

  const messageAttributes = {
    eventType: {
      DataType: 'String',
      StringValue: 'TRANSACTION_CANCELLATION',
    },
    clientTransactionId: {
      DataType: 'String',
      StringValue: booking.clientTransactionId,
    },
  };

  const publishCommand = snsPublishCommand(
    process.env.REFUND_REQUEST_TOPIC_ARN,
    refundMessage,
    `Refund Request for Booking ${booking.bookingId}`,
    messageAttributes
  );

  const result = await snsPublishSend(publishCommand);
  logger.info(`Refund request published for transaction ${booking.clientTransactionId}`);

  return result;
}


module.exports = {
  buildActivityFilters,
  calculateDateRange,
  cancelBooking,
  cancellationPublishCommand,
  completeBooking,
  createBooking,
  fetchAllActivities,
  fetchBookingsWithPagination,
  getBookingsByActivityDetails,
  getBookingByBookingId,
  getBookingsByUserId,
  refundPublishCommand,
  validateAdminRequirements,
  validateDateRange,
  validateCollectionAccess,
};
