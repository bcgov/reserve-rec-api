const { TABLE_NAME, runQuery, getOne, marshall } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/activities/configs");

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
        queryObj.ExpressionAttributeValues[`:${item.name}`] = marshall(
          filters[item.name]
        );
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
 * @param {Object} acCollectionId - The Activity Collection ID of the activity.
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
async function getActivitiesByAcCollectionId(acCollectionId, filters, params = null) {
  logger.info("Get Activities by Activity Collection ID");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${acCollectionId}` },
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
 * @param {Object} acCollectionId - The Activity Collection Id of the activity.
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
  acCollectionId,
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
        ":pk": { S: `activity::${acCollectionId}` },
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
 * @param {Object} acCollectionId - The Activity Collection ID of the activity.
 * @param {Object} activityType - Type of activity to retrieve.
 * @param {Object} activityId - The ID of the activity to retrieve.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: activity object
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getActivityByActivityId(acCollectionId, activityType, activityId) {
  logger.info("Get Activity By activity type and ID");
  console.log('in here')
  try {
    let res = await getOne(
      `activity::${acCollectionId}`,
      `${activityType}::${activityId}`
    );
    console.log('res?', res)
    return res;

  } catch (error) {
    throw new Exception("Error getting activity", { code: 400, error: error });
  }
}

/**
 * Processes incoming requests by handling batch operations and individual items.
 * Validates activityType and activityId parameters, falling back to body values if needed.
 *
 * @param {Object} acCollectionId - Activity Collection ID number
 * @param {string} activityType - Type of activity
 * @param {string} activityId - ID of the activity
 * @param {Object|Array} body - Request payload (single item or array of items)
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 *
 * @returns {Array} Array of processed update requests
 */
function parseRequest(acCollectionId, activityType, activityId, body, requestType) {
  let updateRequests = [];
  // Check if the request is a batch request
  if (Array.isArray(body)) {
    for (let item of body) {
      const { sk } = item;
      updateRequests.push(
        processItem(acCollectionId, activityType, activityId, sk, item, requestType)
      );
    }
  } else {
    const { sk } = body;
    updateRequests.push(
      processItem(acCollectionId, activityType, activityId, sk, body, requestType)
    );
  }

  return updateRequests;
}

/**
 * Processes individual items based on request type, creating appropriate key structures.
 * Handles PUT and POST requests differently, managing primary and sort keys accordingly.
 *
 * @param {Object} acCollectionId - Activity Collection ID number
 * @param {string} activityType - Type of activity
 * @param {string} activityId - ID of the activity
 * @param {string} [sk] - Optional sort key (defaults to ${activityType}::${activityId})
 * @param {Object} item - Item data to process
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 *
 * @returns {Object} Processed item with key structure and data
 */
function processItem(acCollectionId, activityType, activityId, sk, item, requestType) {
  activityType = activityType ?? item?.activityType;
  activityId = activityId ?? item?.activityId;

  if (!sk) {
    if (item.activityType && activityType != item.activityType) {
      throw new Error(`activityType endpoint "${activityType}" doesn't match body's "${item.activityType}"`, { code: 400 });
    }
    if (item.activityId && activityId != item.activityId) {
      throw new Error(`activityId endpoint "${activityId}" doesn't match body's "${item.activityId}"`, { code: 400 });
    }
  }

  const pk = `activity::${acCollectionId}`;
  sk = sk ? sk : `${activityType}::${activityId}`;

  validateSortKey(activityType, activityId, sk);

  if (requestType == "PUT") {
    // Remove items that can't be in a PUT request
    delete item.pk;
    delete item.sk;
    delete item.activityType;
    delete item.activityId;
  } else if (requestType == "POST") {
    // Create items for the POST request
    item.pk = pk;
    item.sk = sk;
  }

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}


/**
 * Validates that the sort key is valid from the activityType and activityId if provided.
 *
 * @param {Object} activityType - Type of activity
 * @param {Object} activityId- The ID of the activity
 * @param {Object} sk- The sort key of the activity
 *
 * @returns {void}
 *
 * @throws {Exception} With code 400 if there's a mismatch between sk and activityType::activityId
 */
function validateSortKey(activityType, activityId, sk) {
  if (!sk && (!activityType && !activityId)) {
    throw new Exception("sk, activityType, and activityId are required.", {
      code: 400,
    });
  }

  if (activityType && sk?.split("::")[0] !== activityType) {
    throw new Exception(`sk "${sk}" in body does not match activityType "${activityType}"`, {
      code: 400,
    });
  }

  if (activityId && sk?.split("::")[1] != activityId) {
    throw new Exception(`sk "${sk}" in body does not match activityId "${activityId}"`, {
      code: 400,
    });
  }
}

module.exports = {
  getActivitiesByAcCollectionId,
  getActivitiesByActivityType,
  getActivityByActivityId,
  parseRequest,
  processItem,
  validateSortKey,
};
