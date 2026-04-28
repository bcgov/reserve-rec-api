const { logger, Exception } = require("/opt/base");
const {
  batchGetData,
  batchTransactData,
  batchWriteData,
  ENTITY_RELATIONSHIP_INDEX,
  marshall,
  REFERENCE_DATA_TABLE_NAME,
  runQuery,
  
} = require("/opt/dynamodb");
const { quickApiPutHandler, quickApiUpdateHandler } = require("./data-utils");

/**
 * The common/relationship-utils file allows other endpoints and methods to
 * import and use these relationship helper methods, which will allow more robust
 * queries to DynamoDB; This allows the user to pull a Facility as well as its
 * related Geozone, or an Activity as well as its related Facility, etc.
 */

/**
 * Helper function to determine if schemas should be swapped
 * Ensures relationships are always created in a consistent order
 *
 * @param schema1 - First entity schema
 * @param schema2 - Second entity schema
 * @return boolean - True if schemas should be swapped
 */
function shouldSwapSchemas(schema1, schema2) {
  // Define hierarchy levels, geozones are top of the charts! Products at the bottom.
  const hierarchy = { geozone: 0, facility: 1, activity: 2, product: 3 };
  const level1 = hierarchy[schema1];
  const level2 = hierarchy[schema2];

  // Swap if schema1 is lower in hierarchy (higher number) than schema2
  return level1 !== undefined && level2 !== undefined && level1 > level2;
}

/**
 * Creates relationship items from entity arrays (facilities, geozones, activities, etc.)
 *
 * @param {string} sourceSchema - Schema of the source entity (e.g., 'activity', 'facility')
 * @param {string} sourcePk - Primary key of the source entity
 * @param {string} sourceSk - Sort key of the source entity
 * @param {Object} entityData - Object containing arrays of related entities
 * @param {Array<string>} relationshipFields - Field names to extract (e.g., ['geozones', 'facilities'])
 *
 * @returns {Object} Object with:
 *   - cleanedData: Entity data with relationship fields removed
 *   - relationshipItems: Array of relationship DynamoDB items ready for batch write
 */
function extractAndCreateRelationships(
  sourceSchema,
  sourcePk,
  sourceSk,
  entityData,
  relationshipFields = [],
) {
  logger.info(`Extracting relationships for ${sourceSchema}`);

  const relationshipItems = [];
  const cleanedData = { ...entityData };

  // Process each relationship field
  for (const field of relationshipFields) {
    const entities = entityData[field];

    if (!entities || !Array.isArray(entities) || entities.length === 0) {
      // Remove empty field from cleaned data
      delete cleanedData[field];
      continue;
    }

    // Determine target schema from field name
    // e.g., coming in as 'geozones' -> 'geozone', or 'facilities' -> 'facility'
    const correctedSchema = {
      facilities: "facility",
      geozones: "geozone",
      activities: "activity",
      products: "product",
    };
    const targetSchema = correctedSchema[field] || field;

    logger.info(`Processing ${entities.length} ${field} relationships`);

    // Create relationship item for each entity
    for (const entity of entities) {
      if (!entity.pk || !entity.sk) {
        logger.warn(`Skipping ${field} entity without pk/sk:`, entity);
        continue;
      }

      let pk1 = sourcePk;
      let sk1 = sourceSk;
      let pk2 = entity.pk;
      let sk2 = entity.sk;

      // Extract schemas for hierarchy check
      const schema1 = pk1.split("::")[0];
      const schema2 = pk2.split("::")[0];

      // Swap if needed to maintain consistent hierarchy order
      if (shouldSwapSchemas(schema1, schema2)) {
        [pk1, sk1, pk2, sk2] = [pk2, sk2, pk1, sk1];
      }

      const relationshipItem = createRelationshipItem(pk1, sk1, pk2, sk2);

      relationshipItems.push({
        PutRequest: {
          Item: relationshipItem,
        },
      });
    }

    // Remove the relationship field from cleaned data
    delete cleanedData[field];
  }

  logger.info(`Created ${relationshipItems.length} relationship items`);

  return {
    cleanedData,
    relationshipItems,
  };
}

/**
 * Creates a single relationship item with bidirectional querying capability
 *
 * @param {string} pk1 - Primary key of the first entity (e.g., 'activity::bcparks_250')
 * @param {string} sk1 - Sort key of the first entity (e.g., 'dayUse::1')
 * @param {string} pk2 - Primary key of the second entity (e.g., 'facility::bcparks_250')
 * @param {string} sk2 - Sort key of the second entity (e.g., 'parking::5')
 *
 * @returns {Object} DynamoDB item in marshalled format
 */
function createRelationshipItem(pk1, sk1, pk2, sk2) {
  // Extract schema types from the pk for metadata
  const schema1 = pk1.split("::")[0];
  const schema2 = pk2.split("::")[0];

  const relationshipItem = {
    pk: { S: `rel::${pk1}::${sk1}` },
    sk: { S: `${pk2}::${sk2}` },
    gsipk: { S: `rel::${pk2}::${sk2}` },
    gsisk: { S: `${pk1}::${sk1}` },
    schema: { S: "relationship" },
    schema1: { S: schema1 },
    schema2: { S: schema2 },
    pk1: { S: pk1 },
    sk1: { S: sk1 },
    pk2: { S: pk2 },
    sk2: { S: sk2 },
  };

  return relationshipItem;
}

// Canonical mapping from plural field names to singular schema names
const FIELD_TO_SCHEMA = {
  facilities: "facility",
  geozones: "geozone",
  activities: "activity",
  products: "product",
};

/**
 * Queries existing relationship items for a given source entity + target schema.
 * Automatically selects the forward table scan or GSI based on the hierarchy.
 *
 * @param {string} sourcePk - e.g. 'facility::bcparks_15'
 * @param {string} sourceSk - e.g. 'accessPoint::1'
 * @param {string} targetSchema - e.g. 'activity'
 * @param {string} tableName
 * @returns {Promise<Array>} Unmarshalled relationship items
 */
async function queryRelationshipsBySchema(
  sourcePk,
  sourceSk,
  targetSchema,
  tableName = REFERENCE_DATA_TABLE_NAME,
) {
  const sourceSchema = sourcePk.split("::")[0];
  const relationshipPk = `rel::${sourcePk}::${sourceSk}`;

  // If source is lower in hierarchy it was stored as pk2; query via GSI.
  // Otherwise it was stored as pk1; query the main table directly.
  if (shouldSwapSchemas(sourceSchema, targetSchema)) {
    const query = {
      TableName: tableName,
      IndexName: ENTITY_RELATIONSHIP_INDEX,
      KeyConditionExpression: "gsipk = :gsipk",
      FilterExpression: "schema1 = :schema1",
      ExpressionAttributeValues: {
        ":gsipk": { S: relationshipPk },
        ":schema1": { S: targetSchema },
      },
    };
    const result = await runQuery(query, null, null, false);
    return result.items || [];
  } else {
    const query = {
      TableName: tableName,
      KeyConditionExpression: "pk = :pk",
      FilterExpression: "schema2 = :schema2",
      ExpressionAttributeValues: {
        ":pk": { S: relationshipPk },
        ":schema2": { S: targetSchema },
      },
    };
    const result = await runQuery(query, null, null, false);
    return result.items || [];
  }
}

/**
 * Diffs existing DB relationships against the incoming entity list.
 * Returns relationship items to add and delete transactions to execute.
 *
 * @param {Array}  existingItems   - Unmarshalled relationship items from the DB
 * @param {Array}  incomingEntities - Entities from the request body (each has pk + sk)
 * @param {string} sourcePk
 * @param {string} sourceSk
 * @param {string} targetSchema
 * @param {string} tableName
 * @returns {{ toAdd: Array, toDelete: Array }}
 */
function diffRelationships(
  existingItems,
  incomingEntities,
  sourcePk,
  sourceSk,
  targetSchema,
  tableName,
) {
  const sourceSchema = sourcePk.split("::")[0];
  const useGSI = shouldSwapSchemas(sourceSchema, targetSchema);

  // Extract the target entity's pk/sk from a stored relationship item
  const getTargetKey = (item) =>
    useGSI
      ? { pk: item.pk1, sk: item.sk1 } // source was pk2, so target is pk1
      : { pk: item.pk2, sk: item.sk2 }; // source was pk1, so target is pk2

  const incomingSet = new Set(
    (incomingEntities || []).map((e) => `${e.pk}::${e.sk}`),
  );
  const existingByTarget = new Map(
    existingItems.map((item) => {
      const t = getTargetKey(item);
      return [`${t.pk}::${t.sk}`, item];
    }),
  );

  const toAdd = [];
  const toDelete = [];

  // Incoming entities not yet in the DB → create relationship items
  for (const entity of incomingEntities || []) {
    if (!existingByTarget.has(`${entity.pk}::${entity.sk}`)) {
      let pk1 = sourcePk,
        sk1 = sourceSk,
        pk2 = entity.pk,
        sk2 = entity.sk;
      if (useGSI) {
        [pk1, sk1, pk2, sk2] = [pk2, sk2, pk1, sk1];
      }
      toAdd.push({
        PutRequest: { Item: createRelationshipItem(pk1, sk1, pk2, sk2) },
      });
    }
  }

  // Existing relationships whose target is absent from incoming → delete
  for (const [key, item] of existingByTarget) {
    if (!incomingSet.has(key)) {
      toDelete.push({
        action: "Delete",
        data: {
          TableName: tableName,
          Key: marshall({ pk: item.pk, sk: item.sk }),
        },
      });
    }
  }

  return { toAdd, toDelete };
}

/**
 * Batch writes relationship items to DynamoDB
 * Uses the existing batchWriteData function from the dynamodb layer
 *
 * @param {Array} relationshipItems - Array of relationship items (PutRequest format)
 * @param {string} tableName - DynamoDB table name
 *
 * @returns {Promise<void>}
 */
async function batchWriteRelationships(relationshipItems, tableName) {
  if (!relationshipItems || relationshipItems.length === 0) {
    logger.info("No relationships to write");
    return;
  }

  logger.info(
    `Writing ${relationshipItems.length} relationships to ${tableName}`,
  );

  const items = relationshipItems.map((item) => item.PutRequest.Item);

  await batchWriteData(items, 25, tableName);

  logger.info(`Successfully wrote ${relationshipItems.length} relationships`);
}

/**
 * Complete workflow for creating entities with relationships and retry logic
 * This consolidates the common pattern used across all entity POST handlers
 *
 * @param {Object} config - Configuration object
 * @param {string} config.schema - Entity schema (e.g., 'activity', 'facility', 'geozone')
 * @param {string} config.collectionId - Collection ID
 * @param {Object} config.body - Request body with entity data
 * @param {Array} [config.parseArgs=[]] - Extra args spread into parseRequest after the method, e.g. [facilityType, facilityId]
 * @param {string} [config.requestMethod='POST'] - HTTP verb forwarded to parseRequest (e.g. 'POST', 'PUT')
 * @param {Array<string>} config.relationshipFields - Fields to extract as relationships
 * @param {Object} config.putConfig - PUT configuration for quickApiPutHandler
 * @param {Function} config.parseRequest - The parseRequest function from entity methods
 * @param {string} [config.tableName=REFERENCE_DATA_TABLE_NAME] - DynamoDB table name
 * @param {number} [config.maxRetries=3] - Maximum retry attempts
 *
 * @returns {Promise<Object>} Object with:
 *   - success: boolean
 *   - postRequests: Array of created entity requests
 *   - relationshipCount: Number of relationships created
 *   - attempts: Number of attempts made
 */
async function createEntityWithRelationships(config) {
  const {
    schema,
    collectionId,
    body,
    parseArgs = [],
    requestMethod = "POST",
    relationshipFields,
    putConfig,
    parseRequest,
    tableName = REFERENCE_DATA_TABLE_NAME,
    maxRetries = 3,
  } = config;

  let postRequests;
  let success = false;
  let attempt = 1;
  let allRelationshipItems = [];
  let allDeleteTransactions = [];

  while (attempt <= maxRetries && !success) {
    // Parse the request to get entity items
    postRequests = await parseRequest(
      collectionId,
      body,
      requestMethod,
      ...parseArgs,
    );

    // For each entity item in the batch, process relationship fields
    ({ postRequests, allRelationshipItems, allDeleteTransactions } =
      await searchAndDeleteRelationshipsForBatch(
        postRequests,
        schema,
        relationshipFields,
        tableName,
        requestMethod,
      ));

    if (allRelationshipItems.length > 0) {
      logger.info(
        `Extracted ${allRelationshipItems.length} total relationship items from ${postRequests.length} ${schema}(ies)`,
      );
    }

    let updateRequest;
    if (requestMethod === "POST") {
      // For POST requests, we create new items
      updateRequest = await quickApiPutHandler(
        tableName,
        postRequests,
        putConfig,
      );
    } else if (requestMethod === "PUT") {
      // If it's a PUT request, we need to update the item
      updateRequest = await quickApiUpdateHandler(
        tableName,
        postRequests,
        putConfig,
      );
    }

    try {
      // Write the entity itself
      await batchTransactData(updateRequest);

      // Delete stale relationship records (PUT only)
      if (allDeleteTransactions.length > 0) {
        logger.info(
          `Deleting ${allDeleteTransactions.length} stale relationships`,
        );
        await batchTransactData(allDeleteTransactions);
      }

      // Write new relationship records
      if (allRelationshipItems.length > 0) {
        logger.info("Writing relationship items to database");
        await batchWriteRelationships(allRelationshipItems, tableName);
      }

      success = true;
      logger.info(`Transaction succeeded on attempt ${attempt}`);
    } catch (error) {
      if (attempt >= maxRetries) {
        logger.error(`Failed after ${maxRetries} attempts.`);
        throw error;
      }

      // Short pause before attempting again
      await new Promise((r) => setTimeout(r, attempt * 100));
      attempt++;
    }
  }

  return postRequests;
}

/**
 * Helper function to process a batch of entity requests and handle relationship extraction and diffing
 * This is used within the createEntityWithRelationships workflow to keep the main function cleaner
 *
 * @param {Array} postRequests - Array of entity requests with data to be created/updated
 * @param {string} schema - Entity schema (e.g., 'activity', 'facility', 'geozone')
 * @param {Array<string>} relationshipFields - Fields to extract as relationships
 * @param {string} tableName - DynamoDB table name
 * @param {string} requestMethod - HTTP verb forwarded to parseRequest (e.g. 'POST', 'PUT')
 *
 * @returns {Promise<Object>} Object with:
 *   - postRequests: Updated array of entity requests with relationship fields removed
 *   - allRelationshipItems: Array of relationship items to be written to DynamoDB
 *   allDeleteTransactions: Array of delete transactions for stale relationships (PUT only)
 */
async function searchAndDeleteRelationshipsForBatch(
  postRequests,
  schema,
  relationshipFields,
  tableName,
  requestMethod,
) {
  let allRelationshipItems = [];
  let allDeleteTransactions = [];

  for (let i = 0; i < postRequests.length; i++) {
    const postRequest = postRequests[i];
    if (!postRequest.key || !postRequest.data) continue;

    const { pk, sk } = postRequest.key;

    if (requestMethod === "PUT") {
      // PUT: diff against the DB so we can add new and remove stale relationships
      for (const field of relationshipFields) {
        const targetSchema = FIELD_TO_SCHEMA[field] || field;
        const incomingEntities = postRequest.data[field] || [];
        const existingItems = await queryRelationshipsBySchema(
          pk,
          sk,
          targetSchema,
          tableName,
        );

        logger.info(
          `Relationship sync for ${pk}::${sk} [${field}]: ${existingItems.length} existing, ${incomingEntities.length} incoming`,
        );

        const { toAdd, toDelete } = diffRelationships(
          existingItems,
          incomingEntities,
          pk,
          sk,
          targetSchema,
          tableName,
        );

        logger.info(`  → ${toAdd.length} to add, ${toDelete.length} to delete`);

        allRelationshipItems.push(...toAdd);
        allDeleteTransactions.push(...toDelete);
      }

      // Strip relationship fields from data before passing to the update handler
      for (const field of relationshipFields) {
        delete postRequests[i].data[field];
      }
    } else {
      // POST: no existing relationships to worry about, just extract and create
      const result = extractAndCreateRelationships(
        schema,
        pk,
        sk,
        postRequest.data,
        relationshipFields,
      );
      postRequests[i].data = result.cleanedData;
      allRelationshipItems.push(...result.relationshipItems);
    }
  }

  return { postRequests, allRelationshipItems, allDeleteTransactions };
}

/**
 * Deletes all relationships associated with an entity (both forward and reverse)
 * Queries both the main table and GSI to find all relationships where the entity
 * is either the source or target
 *
 * @param {string} schema - Entity schema (e.g., 'activity', 'facility', 'geozone')
 * @param {string} pk - Primary key of the entity (e.g., 'activity::bcparks_250')
 * @param {string} sk - Sort key of the entity (e.g., 'dayuse::1')
 * @param {string} [tableName=REFERENCE_DATA_TABLE_NAME] - DynamoDB table name
 *
 * @returns {Promise<Object>} Object with:
 *   - deletedCount: Number of relationships deleted
 *   - forwardRelationships: Number of forward relationships deleted
 *   - reverseRelationships: Number of reverse relationships deleted
 */
async function deleteEntityRelationships(
  pk,
  sk,
  tableName = REFERENCE_DATA_TABLE_NAME,
) {
  logger.info(`Deleting all relationships for ${pk}:${sk}`);

  // Construct the relationship pk using full entity pk
  // e.g., 'activity::bcparks_250' -> 'rel::activity::bcparks_250::dayUse::1'
  const relationshipPk = `rel::${pk}::${sk}`;

  logger.info(`Querying forward relationships with pk: ${relationshipPk}`);

  // Query for forward relationships (where this entity is the source)
  const forwardQuery = {
    TableName: tableName,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: {
      ":pk": { S: relationshipPk },
    },
  };

  const forwardResults = await runQuery(forwardQuery);
  const forwardRelationships = forwardResults.items || [];

  logger.info(`Found ${forwardRelationships.length} forward relationships`);

  // Query for reverse relationships (where this entity is the target) using GSI
  let reverseRelationships = [];
  try {
    const reverseQuery = {
      TableName: tableName,
      IndexName: ENTITY_RELATIONSHIP_INDEX,
      KeyConditionExpression: "gsipk = :gsipk",
      ExpressionAttributeValues: {
        ":gsipk": { S: relationshipPk },
      },
    };

    const reverseResults = await runQuery(reverseQuery);
    reverseRelationships = reverseResults.items || [];

    logger.info(`Found ${reverseRelationships.length} reverse relationships`);
  } catch (gsiError) {
    logger.warn(
      "Error querying GSI for reverse relationships (GSI may not exist):",
      gsiError.message,
    );
    logger.info("Continuing with forward relationships only");
  }

  // Combine all relationships to delete
  const allRelationships = [...forwardRelationships, ...reverseRelationships];

  if (allRelationships.length === 0) {
    logger.info("No relationships to delete");
    return {
      deletedCount: 0,
      forwardRelationships: 0,
      reverseRelationships: 0,
    };
  }

  logger.info(`Deleting ${allRelationships.length} total relationships`);

  // Create delete transactions
  const deleteTransactions = allRelationships.map((item) => ({
    action: "Delete",
    data: {
      TableName: tableName,
      Key: marshall({
        pk: item.pk,
        sk: item.sk,
      }),
    },
  }));

  // Execute deletes in batches (DynamoDB TransactWriteItems limit is 100)
  const batchSize = 100;
  for (let i = 0; i < deleteTransactions.length; i += batchSize) {
    const batch = deleteTransactions.slice(i, i + batchSize);
    logger.info(
      `Deleting batch ${Math.floor(i / batchSize) + 1}: ${batch.length} relationships`,
    );
    await batchTransactData(batch);
  }

  logger.info(`Successfully deleted ${allRelationships.length} relationships`);

  return {
    deletedCount: allRelationships.length,
    forwardRelationships: forwardRelationships.length,
    reverseRelationships: reverseRelationships.length,
  };
}

/**
 * Expand relationship items by fetching the actual target entities
 * For bidirectional queries, determines which entity to fetch based on the query source
 * @param {Array} relationshipItems - Array of relationship items
 * @param {boolean} bidirectional - If true, intelligently fetch the "other" entity
 * @param {string} sourcePk - The pk we're querying from (e.g., "rel::activity::bcparks_250::backcountryCamp::1")
 * @returns {Promise<Array>} Relationship items with populated entity data
 */
async function expandRelationships(
  relationshipItems,
  bidirectional = false,
  sourcePk = null,
) {
  if (!relationshipItems || relationshipItems.length === 0) {
    return [];
  }

  // Extract unique entity keys
  // For bidirectional queries, we need to intelligently pick which entity to fetch
  const entityKeys = relationshipItems.map((rel) => {
    // If this is a bidirectional query and we have a sourcePk
    if (bidirectional && sourcePk) {
      // If the relationship pk matches our source, fetch pk2::sk2 (forward direction)
      // If the relationship pk doesn't match, fetch pk1::sk1 (reverse direction)
      if (rel.pk === sourcePk) {
        // Forward relationship: fetch the target (pk2::sk2)
        return { pk: rel.pk2, sk: rel.sk2 };
      } else {
        // Reverse relationship: fetch the source (pk1::sk1)
        return { pk: rel.pk1, sk: rel.sk1 };
      }
    }

    // Default behavior: always fetch pk2::sk2
    return { pk: rel.pk2, sk: rel.sk2 };
  });

  // Remove duplicates
  const uniqueKeysMap = new Map();
  for (const key of entityKeys) {
    const keyStr = `${key.pk}::${key.sk}`;
    uniqueKeysMap.set(keyStr, key);
  }
  const uniqueKeys = Array.from(uniqueKeysMap.values());

  // Batch fetch all entities
  const entities = await batchGetData(uniqueKeys, REFERENCE_DATA_TABLE_NAME);

  // Create a lookup object to quickly find entities by their pk::sk
  const entityLookup = {};
  for (const entity of entities) {
    const lookupKey = `${entity.pk}::${entity.sk}`;
    entityLookup[lookupKey] = entity;
  }

  // Attach the matching entity to each relationship item
  const expandedRelationships = [];
  for (const rel of relationshipItems) {
    let lookupKey;

    // Use the same logic as above to determine which entity to attach
    if (bidirectional && sourcePk) {
      if (rel.pk === sourcePk) {
        lookupKey = `${rel.pk2}::${rel.sk2}`;
      } else {
        lookupKey = `${rel.pk1}::${rel.sk1}`;
      }
    } else {
      lookupKey = `${rel.pk2}::${rel.sk2}`;
    }

    const matchingEntity = entityLookup[lookupKey] || null;

    expandedRelationships.push({
      ...rel,
      entity: matchingEntity,
    });
  }

  return expandedRelationships;
}

/**
 * Query relationships by pk
 * @param {string} pk - The pk value to query (e.g., "rel::geozone::bcparks_250::1")
 * @param {string} schema2 - Optional: filter by source schema (filters sk with begins_with)
 * @param {object} params - Query parameters (limit, lastEvaluatedKey, paginated)
 * @returns {Promise<object>} Query result with items array
 */
async function getRelationshipsByPk(pk, schema2 = null, params = {}) {
  logger.info("Get Relationships by pk");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated !== undefined ? params.paginated : true;
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: pk },
      },
    };

    if (schema2) {
      queryObj.KeyConditionExpression += " AND begins_with(sk, :sk)";
      queryObj.ExpressionAttributeValues[":sk"] = { S: `${schema2}::` };
    }
    logger.info("Querying relationships with:", queryObj);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Relationships: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting Relationships", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Query relationships by gsipk (reverse direction via GSI)
 * Finds all relationships WHERE the entity is the target
 * @param {string} gsipk - The gsipk value to query (e.g., "rel::activity::bcparks_250::backcountryCamp::1")
 * @param {string} schema1 - Optional: filter by source schema (filters sk with begins_with)
 * @param {object} params - Query parameters (limit, lastEvaluatedKey, paginated)
 * @returns {Promise<object>} Query result with items array
 */
async function getRelationshipsByGsipk(gsipk, schema1 = null, params = {}) {
  logger.info("Get Relationships by gsipk (reverse lookup)");
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated !== undefined ? params.paginated : true;

    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      IndexName: ENTITY_RELATIONSHIP_INDEX,
      KeyConditionExpression: "gsipk = :gsipk",
      ExpressionAttributeValues: {
        ":gsipk": { S: gsipk },
      },
    };

    // If user passes in a schema, we're only grabbing that
    // e.g. query rel::activity::[...] and schema1='geozone'
    //      we ignore the *facility* relationships for activity
    if (schema1) {
      queryObj.KeyConditionExpression += " AND begins_with(gsisk, :gsisk)";
      queryObj.ExpressionAttributeValues[":gsisk"] = { S: `${schema1}::` };
    }

    logger.info("Querying relationships (GSI) with:", queryObj);

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Reverse relationships: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting Relationships via GSI", {
      code: 400,
      error: error,
    });
  }
}

module.exports = {
  batchWriteRelationships,
  createEntityWithRelationships,
  createRelationshipItem,
  deleteEntityRelationships,
  diffRelationships,
  getRelationshipsByPk,
  getRelationshipsByGsipk,
  expandRelationships,
  extractAndCreateRelationships,
  queryRelationshipsBySchema,
};
