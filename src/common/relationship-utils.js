const { logger, Exception } = require("/opt/base");
const { batchWriteData, REFERENCE_DATA_TABLE_NAME, ENTITY_RELATIONSHIP_INDEX, batchTransactData, runQuery, marshall } = require("/opt/dynamodb");
const { quickApiPutHandler } = require("./data-utils");

/*
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
  relationshipFields = []
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
      const schema1 = pk1.split('::')[0];
      const schema2 = pk2.split('::')[0];

      // Swap if needed to maintain consistent hierarchy order
      if (shouldSwapSchemas(schema1, schema2)) {
        [pk1, sk1, pk2, sk2] = [pk2, sk2, pk1, sk1];
      }

      const relationshipItem = createRelationshipItem(
        pk1,
        sk1,
        pk2,
        sk2
      );

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
  const schema1 = pk1.split('::')[0];
  const schema2 = pk2.split('::')[0];

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
    `Writing ${relationshipItems.length} relationships to ${tableName}`
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
 * @param {string} config.entityType - Entity type for parseRequest (e.g., activityType, facilityType)
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
    entityType,
    relationshipFields,
    putConfig,
    parseRequest,
    tableName = REFERENCE_DATA_TABLE_NAME,
    maxRetries = 3
  } = config;

  let postRequests;
  let success = false;
  let attempt = 1;
  let allRelationshipItems = [];

  while (attempt <= maxRetries && !success) {
    // Parse the request to get entity items
    postRequests = await parseRequest(collectionId, body, "POST", entityType);

    // Extract relationship fields for each entity in the batch
    allRelationshipItems = [];
    for (let i = 0; i < postRequests.length; i++) {
      const postRequest = postRequests[i];
      if (postRequest.key && postRequest.data) {
        const result = extractAndCreateRelationships(
          schema,
          postRequest.key.pk,
          postRequest.key.sk,
          postRequest.data,
          relationshipFields
        );

        // Use cleaned data without relationship fields
        postRequests[i].data = result.cleanedData;
        allRelationshipItems.push(...result.relationshipItems);
      }
    }

    if (allRelationshipItems.length > 0) {
      logger.info(
        `Extracted ${allRelationshipItems.length} total relationship items from ${postRequests.length} ${schema}(ies)`
      );
    }

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(
      tableName,
      postRequests,
      putConfig
    );

    try {
      // Attempt to create the entity
      await batchTransactData(putItems);

      // After successfully creating the entity, create the relationships
      if (allRelationshipItems.length > 0) {
        logger.info('Writing relationship items to database');
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

  return {
    success,
    postRequests,
    relationshipCount: allRelationshipItems.length,
    attempts: attempt
  };
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
async function deleteEntityRelationships(pk, sk, tableName = REFERENCE_DATA_TABLE_NAME) {
  logger.info(`Deleting all relationships for ${pk}:${sk}`);
  
  // Construct the relationship pk using full entity pk
  // e.g., 'activity::bcparks_250' -> 'rel::activity::bcparks_250::dayUse::1'
  const relationshipPk = `rel::${pk}::${sk}`;
  
  logger.info(`Querying forward relationships with pk: ${relationshipPk}`);
  
  // Query for forward relationships (where this entity is the source)
  const forwardQuery = {
    TableName: tableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: relationshipPk }
    }
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
      KeyConditionExpression: 'gsipk = :gsipk',
      ExpressionAttributeValues: {
        ':gsipk': { S: relationshipPk }
      }
    };
    
    const reverseResults = await runQuery(reverseQuery);
    reverseRelationships = reverseResults.items || [];
    
    logger.info(`Found ${reverseRelationships.length} reverse relationships`);
  } catch (gsiError) {
    logger.warn('Error querying GSI for reverse relationships (GSI may not exist):', gsiError.message);
    logger.info('Continuing with forward relationships only');
  }
  
  // Combine all relationships to delete
  const allRelationships = [...forwardRelationships, ...reverseRelationships];
  
  if (allRelationships.length === 0) {
    logger.info('No relationships to delete');
    return {
      deletedCount: 0,
      forwardRelationships: 0,
      reverseRelationships: 0
    };
  }
  
  logger.info(`Deleting ${allRelationships.length} total relationships`);
  
  // Create delete transactions
  const deleteTransactions = allRelationships.map(item => ({
    action: 'Delete',
    data: {
      TableName: tableName,
      Key: marshall({
        pk: item.pk,
        sk: item.sk
      })
    }
  }));
  
  // Execute deletes in batches (DynamoDB TransactWriteItems limit is 100)
  const batchSize = 100;
  for (let i = 0; i < deleteTransactions.length; i += batchSize) {
    const batch = deleteTransactions.slice(i, i + batchSize);
    logger.info(`Deleting batch ${Math.floor(i / batchSize) + 1}: ${batch.length} relationships`);
    await batchTransactData(batch);
  }
  
  logger.info(`Successfully deleted ${allRelationships.length} relationships`);
  
  return {
    deletedCount: allRelationships.length,
    forwardRelationships: forwardRelationships.length,
    reverseRelationships: reverseRelationships.length
  };
}

module.exports = {
  batchWriteRelationships,
  createEntityWithRelationships,
  createRelationshipItem,
  deleteEntityRelationships,
  extractAndCreateRelationships,
};
