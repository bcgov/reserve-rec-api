const { TABLE_NAME, runQuery, getOne, marshall, incrementCounter } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("./configs");
/**
 * Adds any filter expressions if any filters were added to query.
 *
 * @param {Object} queryObj - The object query
 * @param {Array} filters - Filter items that are passed from the query
 *
 * @returns {Object} the queryObj with any FilterExpressions added
 *
 */
function addFilters(queryObj, filters) {
  try {
    ALLOWED_FILTERS.forEach((item) => {
      if (item.name in filters) {
        if (queryObj.FilterExpression) {
          queryObj.FilterExpression += " AND ";
        } else if (!queryObj.FilterExpression) {
          queryObj.FilterExpression = "";
        }
        if (!queryObj.ExpressionAttributeNames) {
          queryObj.ExpressionAttributeNames = {};
        }

        if (item.type == "list") {
          queryObj.FilterExpression += `contains(#${item.name}, :${item.name})`;
        } else {
          queryObj.FilterExpression += `#${item.name} = :${item.name}`;
        }

        queryObj.ExpressionAttributeNames[`#${item.name}`] = item.name;
        if (item.type == "number") {
          queryObj.ExpressionAttributeValues[`:${item.name}`] = { N: String(filters[item.name]) };
        } else {
          queryObj.ExpressionAttributeValues[`:${item.name}`] = marshall(
            filters[item.name]
          );
        }
      }
    });

    return queryObj;
  } catch (error) {
    throw error;
  }
}

/**
 * Retrieves all activities matching an Activity Collection ID.
 *
 * @async
 * @param {Object} collectionId - The Activity Collection ID of the activity.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of activity objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 *
 */
async function getActivitiesByCollectionId(collectionId, filters, params = null) {
  logger.info("Get Activities by Activity Collection ID");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${collectionId}` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Activities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting activities", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves activities matching the specified activity type.
 *
 * @async
 * @param {Object} collectionId - The Activity Collection Id of the activity.
 * @param {Object} activityType - Type of activity to retrieve.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of activity objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getActivitiesByActivityType(
  collectionId,
  activityType,
  filters,
  params = null
) {
  logger.info("Get Activity by activity type");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${collectionId}` },
        ":sk": { S: `${activityType}::` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Activities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting activities", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves activities matching the specified activity type.
 *
 * @async
 * @param {Object} collectionId - The Activity Collection ID of the activity.
 * @param {Object} activityType - Type of activity to retrieve.
 * @param {Object} activityId - The ID of the activity to retrieve.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: activity object
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getActivityByActivityId(collectionId, activityType, activityId, fetchGeozone = false) {
  logger.info("Get Activity By activity type and ID");
  try {
    let res = await getOne(
      `activity::${collectionId}`,
      `${activityType}::${activityId}`
    );
    if (fetchGeozone && res?.geozone?.pk && res?.geozone?.sk) {
      const geozone = await getOne(res.geozone.pk, res.geozone.sk);
      res.geozone = geozone;
    }
    return res;

  } catch (error) {
    throw new Exception("Error getting activity", { code: 400, error: error });
  }
}

/**
 * Processes incoming requests by handling batch operations and individual items.
 * Validates activityType and activityId parameters, falling back to body values if needed.
 *
 * @param {Object} collectionId - Activity Collection ID number
 * @param {Object|Array} body - Request payload (single item or array of items)
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} activityType - Type of activity
 * @param {string} [activityId] - Optional ID of the activity
 *
 * @returns {Array} Array of processed update requests
 */
async function parseRequest(collectionId, body, requestType, activityType, activityId = null) {
  let updateRequests = [];
  // Check if the request is a batch request
  if (Array.isArray(body)) {
    for (let item of body) {
      updateRequests.push(
        await processItem(collectionId, item, requestType, activityType, activityId)
      );
    }
  } else {
    updateRequests.push(
      await processItem(collectionId, body, requestType, activityType, activityId)
    );
  }

  return updateRequests;
}

/**
 * Processes individual items based on request type, creating appropriate key structures.
 * Handles PUT and POST requests differently, managing primary and sort keys accordingly.
 *
 * @param {Object} collectionId - Activity Collection ID number
 * @param {Object} item - Item data to process
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} activityType - Type of activity
 * @param {string} [activityId] - Optional ID of the activity
 *
 * @returns {Object} Processed item with key structure and data
 */
async function processItem(
  collectionId,
  item,
  requestType,
  activityType,
  activityId = null
) {
  const pk = `activity::${collectionId}`;
  let sk = null

  // You should have a activityType in queryParams or the item
  if (!activityType && !item.activityType) {
    throw new Error(`activityType is not specified in one of the requests.`, { code: 400 });
  }

  // activityType should be taken from queryParams, but can be taken from item if it's a bulk update
  activityType = activityType ?? item?.activityType;

  if (requestType == "PUT") {
    // Throw an error if activityId is not passed in
    if (!activityId && !item.activityId) {
      throw new Error(`activityId is not specified in one of the requests.`, { code: 400 });
    }

    // activityId should be taken from queryParams, but can be taken from item if it's a bulk update
    activityId = activityId ?? item?.activityId;
    sk = `${activityType}::${activityId}`;

    // Remove items that can't be in a PUT request
    delete item.pk;
    delete item.sk;
    delete item.activityType;
    delete item.activityId;
  } else if (requestType == "POST") {
    // Throw an error if activityId is passed in POST request, as we only allow auto increment for POST requests
    if (activityId) {
      throw new Error(
        "Can't specify activityId in POST request; must be null to allow auto increment",
        { code: 400 }
      );
    }

    // If it's a retry attempt, remove these attributes from the item (if they exist)
    delete item?.activityId;
    delete item?.creationDate;
    delete item?.lastUpdated;
    delete item?.version;

    // If it's a POST request, we need to increment the identifier
    // or we need to create the counter if it doesn't already exist. incrementCounter does either.
    // Pass in the pk to start iterating the collection.
    const identifier = await incrementCounter(pk, [activityType]);

    // Create the sk from the activityType and the identifier
    sk = `${activityType}::${String(identifier)}`;

    item.pk = pk;
    item.sk = sk;
    item.activityType = activityType;
    item.activityId = Number(identifier);
    item.identifier = Number(identifier);
  }

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}

module.exports = {
  getActivitiesByCollectionId,
  getActivitiesByActivityType,
  getActivityByActivityId,
  parseRequest,
  processItem
};
