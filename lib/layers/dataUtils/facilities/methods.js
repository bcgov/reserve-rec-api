const { TABLE_NAME, runQuery, getOne, marshall } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/facilities/configs");

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
 * @param {Object} orcs - The ORCS number.
 * @param {Object} facilityType - Type of facility.
 * @param {Object} facilityId - The ID of the facility.
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
 * Processes incoming requests by handling batch operations and individual items.
 * Validates facilityType and facilityId parameters, falling back to body values if needed.
 *
 * @param {Object} orcs - ORCS number
 * @param {string} facilityType - Type of facility
 * @param {string} facilityId - ID of the facility
 * @param {Object|Array} body - Request payload (single item or array of items)
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 *
 * @returns {Array} Array of processed update requests
 */
function parseRequest(orcs, facilityType, facilityId, body, requestType) {
  let updateRequests = [];
  // Check if the request is a batch request
  if (Array.isArray(body)) {
    for (let item of body) {
      const { sk } = item;
      updateRequests.push(
        processItem(orcs, facilityType, facilityId, sk, item, requestType)
      );
    }
  } else {
    const { sk } = body;
    updateRequests.push(
      processItem(orcs, facilityType, facilityId, sk, body, requestType)
    );
  }

  return updateRequests;
}

/**
 * Processes individual items based on request type, creating appropriate key structures.
 * Handles PUT and POST requests differently, managing primary and sort keys accordingly.
 *
 * @param {Object} orcs - ORCS number
 * @param {string} facilityType - Type of facility
 * @param {string} facilityId - ID of the facility
 * @param {string} [sk] - Optional sort key (defaults to ${facilityType}::${facilityId})
 * @param {Object} item - Item data to process
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 *
 * @returns {Object} Processed item with key structure and data
 */
function processItem(orcs, facilityType, facilityId, sk, item, requestType) {  
  facilityType = facilityType ?? item?.facilityType;
  facilityId = facilityId ?? item?.facilityId;
  
  if (!sk) {
    if (item.facilityType && facilityType !== item.facilityType) {
      throw new Error(`facilityType endpoint "${facilityType}" doesn't match body's "${item.facilityType}"`, { code: 400 });
    }
    if (item.facilityId && facilityId !== item.facilityId) {
      throw new Error(`facilityId endpoint "${facilityId}" doesn't match body's "${item.facilityId}"`, { code: 400 });
    }
  }
    
  const pk = `facility::${orcs}`;
  sk = sk ? sk : `${facilityType}::${facilityId}`;
  
  validateSortKey(facilityType, facilityId, sk);

  if (requestType == "PUT") {
    // Remove items that can't be in a PUT request
    delete item.pk;
    delete item.sk;
    delete item.facilityType;
    delete item.facilityId;
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
  if (!sk && (!facilityType && !facilityId)) {
    throw new Exception("sk, facilityType, and facilityId are required.", {
      code: 400,
    });
  }

  if (facilityType && sk?.split("::")[0] !== facilityType) {
    throw new Exception(`sk "${sk}" in body does not match facilityType "${facilityType}"`, {
      code: 400,
    });
  }

  if (facilityId && sk?.split("::")[1] != facilityId) {
    throw new Exception(`sk "${sk}" in body does not match facilityId "${facilityId}"`, {
      code: 400,
    });
  }
}

module.exports = {
  getFacilitiesByOrcs,
  getFacilitiesByFacilityType,
  getFacilityByFacilityId,
  parseRequest,
  processItem,
  validateSortKey,
};
