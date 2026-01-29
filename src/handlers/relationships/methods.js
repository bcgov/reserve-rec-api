const { logger, Exception } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, ENTITY_RELATIONSHIP_INDEX, runQuery, batchGetData } = require("/opt/dynamodb");

/**
 * Expand relationship items by fetching the actual target entities
 * For bidirectional queries, determines which entity to fetch based on the query source
 * @param {Array} relationshipItems - Array of relationship items
 * @param {boolean} bidirectional - If true, intelligently fetch the "other" entity
 * @param {string} sourcePk - The pk we're querying from (e.g., "rel::activity::bcparks_250::backcountryCamp::1")
 * @returns {Promise<Array>} Relationship items with populated entity data
 */
async function expandRelationships(relationshipItems, bidirectional = false, sourcePk = null) {
  if (!relationshipItems || relationshipItems.length === 0) {
    return [];
  }

  // Extract unique entity keys
  // For bidirectional queries, we need to intelligently pick which entity to fetch
  const entityKeys = relationshipItems.map(rel => {
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
      entity: matchingEntity
    });
  }

  return expandedRelationships;
}

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
  getRelationshipsByPk,
  getRelationshipsByGsipk,
  expandRelationships
};
