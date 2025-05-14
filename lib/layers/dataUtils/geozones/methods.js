const {
  TABLE_NAME,
  runQuery,
  marshall,
  incrementCounter
} = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("/opt/geozones/configs");

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
        if (!queryObj.FilterExpression) {
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
 * @param {Object} filters - Allowed filters for the item.
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
 * Processes incoming requests by handling batch operations and individual items.
 *
 * @param {Object} gzCollectionId - gzCollectionId (e.g. bcparks::1)
 * @param {Object|Array} body - Request payload (single item or array of items)
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} [geozoneId] - Optional ID of the geozone (for "PUT" requests)
 *
 * @returns {Array} Array of processed update requests
 */
async function parseRequest(gzCollectionId, body, requestType, geozoneId = null) {
  let updateRequests = [];
  // Check if the request is a batch request
  if (Array.isArray(body)) {
    for (let item of body) {
      updateRequests.push(
        await processItem(gzCollectionId, item, requestType, geozoneId)
      );
    }
  } else {
    updateRequests.push(
      await processItem(gzCollectionId, body, requestType, geozoneId)
    );
  }

  return updateRequests;
}

/**
 * Processes individual items based on request type, creating appropriate key structures.
 * Handles PUT and POST requests differently, managing primary and sort keys accordingly.
 *
 * @param {Object} gzCollectionId - gzCollectionId (e.g. bcparks::1)
 * @param {Object} item - Item data to process
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} [geozoneId] - Optional ID of the geozone
 *
 * @returns {Object} Processed item with key structure and data
 */
async function processItem(
  gzCollectionId,
  item,
  requestType,
  geozoneId = null
) {
  const pk = `geozone::${gzCollectionId}`;
  let sk = null

  if (requestType == "PUT") {
    // Throw an error if geozoneId is not passed in
    if (!geozoneId && !item.geozoneId) {
      throw new Error(`geozoneId is not specified in one of the requests.`, { code: 400 });
    }

    // geozoneId should be taken from queryParams, but can be taken from item if it's a bulk update
    geozoneId = geozoneId ?? item?.geozoneId;
    sk = geozoneId;
    
    // Remove items that can't be in a PUT request
    delete item.pk;
    delete item.sk;
    delete item.geozoneId;
  } else if (requestType == "POST") {
    // Throw an error if geozoneId is passed in POST request, as we only allow auto increment for POST requests
    if (geozoneId) {
      throw new Error(
        "Can't specify geozoneId in POST request; must be null to allow auto increment",
        { code: 400 }
      );
    }

    // If it's a retry attempt, remove these attributes from the item (if they exist)
    delete item?.geozoneId;
    delete item?.creationDate;
    delete item?.lastUpdated;
    delete item?.version;

    // If it's a POST request, we need to increment the identifier
    // or we need to create the counter if it doesn't already exist. incrementCounter does either.
    // Pass in the pk to start iterating the collection.
    const identifier = await incrementCounter(pk);

    // Create the sk from the identifier
    sk = String(identifier);

    item.pk = pk;
    item.sk = sk;
    item.geozoneId = Number(identifier);
    item.identifier = Number(identifier);
  }

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}

module.exports = {
  getGeozonesByGzCollectionId,
  getGeozonesByGeozoneId,
  parseRequest
};
