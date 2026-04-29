const {
  REFERENCE_DATA_TABLE_NAME,
  batchGetData,
  runQuery,
  getOne,
  marshall,
  incrementCounter,
} = require("/opt/dynamodb");
const { Exception, logger, filterByRole } = require("/opt/base");
const { ALLOWED_FILTERS, ROLE_BASED_FILTERS } = require("./configs");
const { getRelationshipsByGsipk, expandRelationships } = require("../../common/relationship-utils");

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
          filters[item.name],
        );
      }
    });

    return queryObj;
  } catch (error) {
    throw error;
  }
}

/**
 * Retrieves all facilities matching a facility collection id.
 *
 * @async
 * @param {Object} collectionId - The collectionId of the facility.
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
async function getFacilitiesByCollectionId(
  collectionId,
  filters,
  params = null,
) {
  logger.info("Get Facilities by Facility Collection ID");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `facility::${collectionId}` },
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
 * @param {Object} collectionId - The facility collection ID of the facility.
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
  collectionId,
  facilityType,
  filters,
  params = null,
) {
  logger.info("Get Facility by Facility Type");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `facility::${collectionId}` },
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
 * @param {Object} collectionId - The facility collection ID number.
 * @param {Object} facilityType - Type of facility.
 * @param {Object} facilityId - The ID of the facility.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: facility object
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getFacilityByFacilityId(
  collectionId,
  facilityType,
  facilityId,
  fetchActivities = false,
  fetchGeozones = false,
) {
  logger.info("Get Facility By Facility Type and ID");
  try {
    let res = await getOne(
      `facility::${collectionId}`,
      `${facilityType}::${facilityId}`,
    );
    if (fetchActivities && res) {
      const activityRelationships = await runQuery({
        TableName: REFERENCE_DATA_TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": {
            S: `rel::facility::${collectionId}::${facilityType}::${facilityId}`,
          },
          ":sk": { S: `activity::` },
        },
      });

      // If there are activity relationships, batch get the activities and add them to the response
      if (activityRelationships?.items?.length > 0) {
        const activityKeys = activityRelationships.items.map((rel) => ({
          pk: rel.pk2,
          sk: rel.sk2,
        }));
        res.activities = await batchGetData(
          activityKeys,
          REFERENCE_DATA_TABLE_NAME,
        );
      } else {
        res.activities = [];
      }
    }

    if (fetchGeozones && res) {
      // Get the geozone(s) that this facility is related to using gsi reverse lookup
      // (because the geozone is always the main pk and facility is the gsipk of this relationship direction)
      const facilityRelPk = `rel::facility::${collectionId}::${facilityType}::${facilityId}`;
      const geozoneRelationships = await getRelationshipsByGsipk(
        facilityRelPk,
        'geozone',
      );

      if (geozoneRelationships?.items?.length > 0) {
        const geozoneKeys = geozoneRelationships.items.map((rel) => ({
          pk: rel.pk1,
          sk: rel.sk1,
        }));
        res.geozones = await batchGetData(
          geozoneKeys,
          REFERENCE_DATA_TABLE_NAME,
        );
      } else {
        res.geozones = [];
      }
    }

    logger.debug(`Facility: ${JSON.stringify(res, null, 2)}`);
    return res;
  } catch (error) {
    throw new Exception("Error getting facility", { code: 400, error: error });
  }
}

/**
 * Processes incoming requests by handling batch operations and individual items.
 * Validates facilityType and facilityId parameters, falling back to body values if needed.
 *
 * @param {Object} collectionId - Facility Collection ID number
 * @param {Object|Array} body - Request payload (single item or array of items)
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} facilityType - Type of facility
 * @param {string} [facilityId] - Optional ID of the facility
 *
 * @returns {Array} Array of processed update requests
 */
async function parseRequest(
  collectionId,
  body,
  requestType,
  facilityType,
  facilityId = null,
) {
  let updateRequests = [];
  // Check if the request is a batch request
  if (Array.isArray(body)) {
    for (let item of body) {
      updateRequests.push(
        await processItem(
          collectionId,
          item,
          requestType,
          facilityType,
          facilityId,
        ),
      );
    }
  } else {
    updateRequests.push(
      await processItem(
        collectionId,
        body,
        requestType,
        facilityType,
        facilityId,
      ),
    );
  }

  return updateRequests;
}

/**
 * Processes individual items based on request type, creating appropriate key structures.
 * Handles PUT and POST requests differently, managing primary and sort keys accordingly.
 *
 * @param {Object} collectionId - Facility Collection ID number
 * @param {Object} item - Item data to process
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} facilityType - Type of facility
 * @param {string} [facilityId] - Optional ID of the facility
 *
 * @returns {Object} Processed item with key structure and data
 */
async function processItem(
  collectionId,
  item,
  requestType,
  facilityType,
  facilityId = null,
) {
  const pk = `facility::${collectionId}`;
  let sk = null;

  // You should have a facilityType in queryParams or the item
  if (!facilityType && !item.facilityType) {
    throw new Error(`facilityType is not specified in one of the requests.`, {
      code: 400,
    });
  }

  // facilityType should be taken from queryParams, but can be taken from item if it's a bulk update
  facilityType = facilityType ?? item?.facilityType;

  if (requestType == "PUT") {
    // Throw an error if facilityId is not passed in
    if (!facilityId && !item.facilityId) {
      throw new Error(`facilityId is not specified in one of the requests.`, {
        code: 400,
      });
    }

    // facilityId should be taken from queryParams, but can be taken from item if it's a bulk update
    facilityId = facilityId ?? item?.facilityId;
    sk = `${facilityType}::${facilityId}`;

    // Remove items that can't be in a PUT request
    delete item.pk;
    delete item.sk;
    delete item.facilityType;
    delete item.facilityId;
  } else if (requestType == "POST") {
    // Throw an error if facilityId is passed in POST request, as we only allow auto increment for POST requests
    if (facilityId) {
      throw new Error(
        "Can't specify facilityId in POST request; must be null to allow auto increment",
        { code: 400 },
      );
    }

    // Make sure defaults are set for the item
    item["collectionId"] = collectionId;
    item["facilityType"] = facilityType;
    if (!item?.hasOwnProperty("showOnMap")) {
      item.showOnMap = true;
    }

    // If it's a retry attempt, remove these attributes from the item (if they exist)
    delete item?.facilityId;
    delete item?.creationDate;
    delete item?.lastUpdated;
    delete item?.version;

    // If it's a POST request, we need to increment the identifier
    // or we need to create the counter if it doesn't already exist. incrementCounter does either.
    // Pass in the pk to start iterating the collection.
    const identifier = await incrementCounter(pk, [facilityType]);

    // Create the sk from the facilityType and the identifier
    sk = `${facilityType}::${String(identifier)}`;

    item.pk = pk;
    item.sk = sk;
    item.facilityType = facilityType;
    item.facilityId = Number(identifier);
    item.identifier = Number(identifier);
  }

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}

async function fetchFacilities(
  collectionId,
  facilityType,
  facilityId,
  queryParams,
  authContext,
) {
  if (!collectionId) {
    throw new Exception("Facility Collection ID (collectionId) is required", {
      code: 400,
    });
  }

  let filters = {};
  let res = null;
  let allowedFilters = ALLOWED_FILTERS;
  // Loop through each allowed filter to check if it's in queryParams
  allowedFilters.forEach((filter) => {
    if (queryParams[filter.name]) {
      // If the filter.name is found in queryParams, add it to the result object
      filters[filter.name] =
        queryParams[filter.name] === "true"
          ? true
          : queryParams[filter.name] === "false"
            ? false
            : queryParams[filter.name];
    }
  });

  if (facilityType && facilityId) {
    res = await getFacilityByFacilityId(
      collectionId,
      facilityType,
      facilityId,
      queryParams?.fetchActivities || false,
      queryParams?.fetchGeozones || false,
    );
  }

  if (facilityType && !facilityId) {
    res = await getFacilitiesByFacilityType(
      collectionId,
      facilityType,
      filters,
      queryParams,
    );
  }

  if (!facilityType && !facilityId) {
    res = await getFacilitiesByCollectionId(collectionId, filters, queryParams);
  }

  // Check user's role from authContext (if provided), otherwise provide default return
  const role = authContext?.permissions?.[collectionId] ?? "default";

  // Filter by the role of the user - for public, that's 'default' (least privilege)
  return filterByRole(res, role, ROLE_BASED_FILTERS);
}

module.exports = {
  getFacilitiesByCollectionId,
  getFacilitiesByFacilityType,
  getFacilityByFacilityId,
  fetchFacilities,
  parseRequest,
  processItem,
};
