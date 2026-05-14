const {
  REFERENCE_DATA_TABLE_NAME,
  runQuery,
  marshall,
  getOne,
} = require("/opt/dynamodb");
const { Exception, logger } = require("/opt/base");
const { ALLOWED_FILTERS } = require("./configs");

/**
 * Adds any filter expressions if any filters were added to query.
 *
 * @param {Object} queryObj - The object query
 * @param {Array} filters - Filter items that are passed from the query
 *
 * @returns {Object} the queryObj with any FilterExpressions added
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
 * Retrieves all collections (pk = 'collection').
 *
 * @async
 * @param {Object} filters - Allowed filters for the query.
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of collection objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getAllCollections(filters = {}, params = null) {
  logger.info("Get All Collections");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated ?? true;

    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: "collection" },
      },
    };

    queryObj = addFilters(queryObj, filters);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);

    logger.info(`Collections: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting collections", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves a single collection by collectionId.
 *
 * @async
 * @param {string} collectionId - The collectionId (sk) of the collection to retrieve.
 *
 * @returns {Promise<Object|null>} The collection item, or null if not found.
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getCollectionByCollectionId(collectionId) {
  logger.info(`Get Collection by collectionId: ${collectionId}`);
  try {
    const item = await getOne("collection", collectionId);
    return item;
  } catch (error) {
    throw new Exception("Error getting collection", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Builds a PUT/POST request object for a collection item.
 *
 * For POST: pk = 'collection', sk = body.collectionId (user-supplied, no counter).
 * For PUT:  pk = 'collection', sk = collectionId from path.
 *
 * @param {Object} body - Request payload
 * @param {string} requestType - "POST" or "PUT"
 * @param {string} [collectionId] - Required for PUT; the collectionId from the path parameter.
 *
 * @returns {Object} Processed item with key structure and data
 */
async function parseRequest(body, requestType, collectionId = null) {
  const pk = "collection";

  if (requestType === "POST") {
    if (!body.collectionId) {
      throw new Exception("collectionId is required in the request body", { code: 400 });
    }

    // Clean up any fields that should not be manually set on creation
    delete body.pk;
    delete body.sk;
    delete body.creationDate;
    delete body.lastUpdated;
    delete body.version;

    const sk = body.collectionId;

    body.pk = pk;
    body.sk = sk;
    body.schema = "collection";

    return { key: { pk, sk }, data: body };
  }

  if (requestType === "PUT") {
    if (!collectionId) {
      throw new Exception("collectionId is required for PUT requests", { code: 400 });
    }

    // Prevent mutation of immutable identity fields
    delete body.pk;
    delete body.sk;
    delete body.collectionId;
    delete body.schema;

    const sk = collectionId;
    return { key: { pk, sk }, data: body };
  }

  throw new Exception(`Unknown requestType: ${requestType}`, { code: 400 });
}

module.exports = {
  getAllCollections,
  getCollectionByCollectionId,
  parseRequest,
};
