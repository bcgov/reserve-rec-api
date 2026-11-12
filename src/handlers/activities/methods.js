const { REFERENCE_DATA_TABLE_NAME, batchGetData, runQuery, getOne, marshall, incrementCounter, excludeDeletedItems, excludeHiddenItems } = require("/opt/dynamodb");
const { Exception, logger, checkAuthContext } = require("/opt/base");
const { ALLOWED_FILTERS, ACTIVITY_RELATIONSHIP_FIELDS } = require("./configs");
const { FIELD_TO_SCHEMA, getActivityFacilityLinks } = require("../../common/relationship-utils");
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
    console.log('queryObj:', queryObj);
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
async function getActivitiesByCollectionId(collectionId, filters, params = null, onlyVisible = false) {
  logger.info("Get Activities by Activity Collection ID");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${collectionId}` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }
    queryObj = excludeDeletedItems(queryObj);
    if (onlyVisible) queryObj = excludeHiddenItems(queryObj);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Activities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    if (error instanceof Exception) throw error;
    logger.error(`Error getting activities: ${error}`);
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
  params = null,
  onlyVisible = false
) {
  logger.info("Get Activity by activity type");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `activity::${collectionId}` },
        ":sk": { S: `${activityType}::` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }
    queryObj = excludeDeletedItems(queryObj);
    if (onlyVisible) queryObj = excludeHiddenItems(queryObj);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Activities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    if (error instanceof Exception) throw error;
    logger.error(`Error getting activities: ${error}`);
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
async function getActivityByActivityId(collectionId, activityType, activityId, fetchFacilities = false, fetchGeozones = false) {
  logger.info("Get Activity By activity type and ID");
  try {
    let res = await getOne(
      `activity::${collectionId}`,
      `${activityType}::${activityId}`
    );
    // Soft-deleted activities are treated as not found
    if (res?.isDeleted) {
      return null;
    }
    // if (fetchGeozones && res?.geozone?.pk && res?.geozone?.sk) {
    //   const geozone = await getOne(res.geozone.pk, res.geozone.sk);
    //   res.geozone = geozone;
    // }
    if (fetchFacilities && res) {
      const links = await getActivityFacilityLinks(collectionId, activityType, activityId);
      const facilities = links.length > 0 ? await batchGetData(links, REFERENCE_DATA_TABLE_NAME) : [];
      res.facilities = facilities.filter((facility) => !facility.isDeleted);
    }
    return res;
  } catch (error) {
    logger.error(`Error getting activity: ${error}`);
    throw new Exception("Error getting activity", { code: 400, error: error });
  }
}

const bodyItems = (body) => (Array.isArray(body) ? body : [body]).filter((item) => item && typeof item === "object");

/**
 * True when the body (or any item of a batch body) carries a relationship field, even an empty one.
 */
function hasRelationshipFields(body) {
  return bodyItems(body).some((item) => ACTIVITY_RELATIONSHIP_FIELDS.some((field) => Object.hasOwn(item, field)));
}

/**
 * Checks every facilities/geozones entry in the body before anything is written:
 * each must be a {pk, sk} string pair, keyed to this collection, naming an entity that exists.
 *
 * @throws {Exception} 400 naming the first bad entry, or every missing one
 */
async function validateRelationshipFields(collectionId, body) {
  const keys = new Map();
  for (const item of bodyItems(body)) {
    for (const field of ACTIVITY_RELATIONSHIP_FIELDS) {
      if (!Object.hasOwn(item, field)) continue;
      const entries = item[field];
      if (!Array.isArray(entries)) {
        throw new Exception(`${field} must be an array of {pk, sk}`, { code: 400 });
      }
      const expectedPk = `${FIELD_TO_SCHEMA[field]}::${collectionId}`;
      for (const entry of entries) {
        if (typeof entry?.pk !== "string" || typeof entry?.sk !== "string" || !entry.sk) {
          throw new Exception(`Invalid ${field} entry ${JSON.stringify(entry)}: expected {pk, sk} strings`, { code: 400 });
        }
        if (entry.pk !== expectedPk) {
          throw new Exception(`Invalid ${field} entry ${entry.pk}::${entry.sk}: pk must be ${expectedPk}`, { code: 400 });
        }
        keys.set(`${entry.pk}::${entry.sk}`, { pk: entry.pk, sk: entry.sk });
      }
    }
  }
  if (keys.size === 0) return;

  const found = await batchGetData([...keys.values()], REFERENCE_DATA_TABLE_NAME);
  if (found?.unprocessedKeys) {
    throw new Exception("Could not check the linked entities; try again", { code: 500 });
  }
  const live = new Set((found || []).filter((entity) => !entity.isDeleted).map((entity) => `${entity.pk}::${entity.sk}`));
  const missing = [...keys.keys()].filter((key) => !live.has(key));
  if (missing.length > 0) {
    throw new Exception(`Linked entities not found: ${missing.join(", ")}`, { code: 400 });
  }
}

/**
 * Only superadmins may set an activity's facilities or geozones; the entries are
 * validated here so a refused request writes nothing, not even the id counter.
 */
async function guardRelationshipFields(event, collectionId, body) {
  if (!hasRelationshipFields(body)) return;
  checkAuthContext(event, "superadmin");
  await validateRelationshipFields(collectionId, body);
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
    
    // Remove activitySubType if null or undefined
    if (!item.activitySubType) delete item.activitySubType;
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
    
    // Remove activitySubType if null or undefined
    if (!item.activitySubType) delete item.activitySubType;
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
  guardRelationshipFields,
  parseRequest,
  processItem,
};
