const { TABLE_NAME, runQuery, getOne, marshall } = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/geozones/constants");

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
 * Retrieves all geozones matching an GzCollectionId.
 *
 * @async
 * @param {Object} gzCollectionId - The GzCollectionId of the geozone.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of geozone objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 *
 */
async function getGeozonesByGzCollectionId(
  gzCollectionId,
  filters,
  params = null
) {
  logger.info("Get Geozones By GzCollectionId");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `geozone::${gzCollectionId}` },
      },
    };

    queryObj = addFilters(queryObj, filters);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Geozones: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting geozones", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves geozones matching the specified Geozone Type.
 *
 * @async
 * @param {Object} gzCollectionId - The GzCollectionId of the geozone.
 * @param {Object} geozoneId - The geozone to retrieve.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of geozone objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getGeozonesByGeozoneId(
  gzCollectionId,
  geozoneId,
  filters,
  params = null
) {
  logger.info("Get Geozone by Geozone Type");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `geozone::${gzCollectionId}` },
        ":sk": { S: `${geozoneId}` },
      },
    };

    queryObj = addFilters(queryObj, filters);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Geozones: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting geozones", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Validates that the sort key is valid from the geozoneId if provided.
 *
 * @param {Object} geozoneId - The geozone ID
 * @param {Object} sk - The sort key of the geozone
 *
 * @returns {void}
 *
 * @throws {Exception} With code 400 if there's a mismatch between sk and geozoneId
 */
function validateSortKey(geozoneId, sk) {
  if (!sk && !geozoneId) {
    throw new Exception("sk or geozoneId are required.", {
      code: 400,
    });
  }

  if (geozoneId && sk != geozoneId) {
    throw new Exception("sk does not match geozoneId", {
      code: 400,
    });
  }
}

module.exports = {
  getGeozonesByGzCollectionId,
  getGeozonesByGeozoneId,
  validateSortKey,
};
