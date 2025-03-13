const { TABLE_NAME, runQuery, getOne, marshall } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/activities/constants");

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
        }
        if (!queryObj.ExpressionAttributeNames) {
          queryObj.ExpressionAttributeNames = {};
        }
        if (!queryObj.FilterExpression) {
          queryObj.FilterExpression = "";
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
 * Retrieves all activities matching an Orcs.
 *
 * @async
 * @param {Object} orcs - The Orcs of the activity.
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
async function getActivitiesByOrcs(orcs, filters, params = null) {
  logger.info("Get Activities by Orcs");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${orcs}` },
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
 * @param {Object} orcs - The Orcs of the activity.
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
  orcs,
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
        ":pk": { S: `activity::${orcs}` },
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
 * @param {Object} orcs - The Orcs of the activity.
 * @param {Object} activityType - Type of activity to retrieve.
 * @param {Object} activityId - The ID of the activity to retrieve.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: activity object
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getActivityByActivityId(orcs, activityType, activityId) {
  logger.info("Get Activity By activity type and ID");
  console.log('in here')
  try {
    let res = await getOne(
      `activity::${orcs}`,
      `${activityType}::${activityId}`
    );
    console.log('res?', res)
    return res;

  } catch (error) {
    throw new Exception("Error getting activity", { code: 400, error: error });
  }
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
  if (!sk && !activityType && !activityId) {
    throw new Exception("sk or activityType and activityId are required.", {
      code: 400,
    });
  }

  if (activityType && sk?.split("::")[0] !== activityType) {
    throw new Exception("sk does not match activityType", {
      code: 400,
    });
  }

  if (activityId && sk?.split("::")[1] != activityId) {
    throw new Exception("sk does not match activityId", {
      code: 400,
    });
  }
}

module.exports = {
  getActivitiesByOrcs,
  getActivitiesByActivityType,
  getActivityByActivityId,
  validateSortKey,
};
