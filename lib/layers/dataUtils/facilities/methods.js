const { TABLE_NAME, runQuery, getOne, marshall } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/facilities/constants");

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
 * Retrieves all facilities matching an ORCS.
 *
 * @async
 * @param {Object} orcs - The ORCS of the facility.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of facility objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 *
 */
async function getFacilitiesByOrcs(orcs, filters, params = null) {
  logger.info("Get Facilities by ORCS");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `facility::${orcs}` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Facilities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting facilities", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves facilities matching the specified Facility Type.
 *
 * @async
 * @param {Object} orcs - The ORCS of the facility.
 * @param {Object} facilityType - Type of facility to retrieve.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of facility objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getFacilitiesByFacilityType(
  orcs,
  facilityType,
  filters,
  params = null
) {
  logger.info("Get Facility by Facility Type");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `facility::${orcs}` },
        ":sk": { S: `${facilityType}::` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Facilities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting facilities", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves facilities matching the specified Facility ID.
 *
 * @async
 * @param {Object} orcs - The ORCS of the facility.
 * @param {Object} facilityType - Type of facility to retrieve.
 * @param {Object} facilityId - The ID of the facility to retrieve.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: facility object
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getFacilityByFacilityId(orcs, facilityType, facilityId) {
  logger.info("Get Facility By Facility Type and ID");
  try {
    let res = await getOne(
      `facility::${orcs}`,
      `${facilityType}::${facilityId}`
    );
    return res;
  } catch (error) {
    throw new Exception("Error getting facility", { code: 400, error: error });
  }
}

/**
 * Validates that the sort key is valid from the facilityType and facilityId if provided.
 *
 * @param {Object} facilityType - Type of facility
 * @param {Object} facilityId- The ID of the facility
 * @param {Object} sk- The sort key of the facility
 *
 * @returns {void}
 *
 * @throws {Exception} With code 400 if there's a mismatch between sk and facilityType::facilityId
 */
function validateSortKey(facilityType, facilityId, sk) {
  if (!sk && !facilityType && !facilityId) {
    throw new Exception("sk or facilityType and facilityId are required.", {
      code: 400,
    });
  }

  if (facilityType && sk?.split("::")[0] !== facilityType) {
    throw new Exception("sk does not match facilityType", {
      code: 400,
    });
  }

  if (facilityId && sk?.split("::")[1] != facilityId) {
    throw new Exception("sk does not match facilityId", {
      code: 400,
    });
  }
}

module.exports = {
  getFacilitiesByOrcs,
  getFacilitiesByFacilityType,
  getFacilityByFacilityId,
  validateSortKey,
};
