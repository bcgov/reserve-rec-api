const { getRelationshipsByPk, getRelationshipsByGsipk, expandRelationships } = require("../../../methods");
const { Exception, logger, sendResponse } = require("/opt/base");

/**
 * GET /relationships/{pk1}/{sk1}
 *
 * Query all relationships FROM a source entity (forward direction)
 * Returns all entities that the source is related to
 *
 * @param pk1 - Full partition key of source entity (e.g., 'activity::bcparks_250')
 * @param sk1 - Sort key of source entity (e.g., 'dayUse::1')
 * @param targetSchema - Optional query param to filter by target entity schema
 * @param expand - Optional query param: if 'true', includes full entity data inline
 * @param bidirectional - Optional query param: if 'true', includes both forward and reverse relationships
 *
 */
exports.handler = async (event, context) => {
  logger.info("GET Relationships From", event);

  const pk1 = event?.pathParameters?.pk1;
  const sk1 = event?.pathParameters?.sk1;
  const targetSchema = event?.queryStringParameters?.targetSchema || null;
  const expand = event?.queryStringParameters?.expand === 'true';
  const bidirectional = event?.queryStringParameters?.bidirectional === 'true';

  // Validate required parameters
  const missingParams = [];
  if (!pk1) missingParams.push("pk1");
  if (!sk1) missingParams.push("sk1");

  if (missingParams.length > 0) {
    throw new Exception(
      `Cannot get relationship - missing required parameter(s): ${missingParams.join(
        ", "
      )}`,
      { code: 400 }
    );
  }

  // Construct the relationship pk for querying
  const pk = `rel::${pk1}::${sk1}`;
  logger.info(`Querying relationships from pk: ${pk}, targetSchema: ${targetSchema}, bidirectional: ${bidirectional}`);

  try {
    // Get forward relationships (pk = rel::{pk1}::{sk1})
    const forwardRes = await getRelationshipsByPk(pk, targetSchema);
    let items = forwardRes.items || [];
    
    // If bidirectional, also get reverse relationships (gsipk = rel::{pk1}::{sk1})
    if (bidirectional) {
      logger.info(`Fetching reverse relationships via GSI`);
      const reverseRes = await getRelationshipsByGsipk(pk, targetSchema);
      const reverseItems = reverseRes.items || [];
      
      logger.info(`Found ${items.length} forward + ${reverseItems.length} reverse relationships`);
      
      // Merge and deduplicate based on pk+sk
      const itemMap = new Map();
      
      // Add forward relationships
      for (const item of items) {
        const key = `${item.pk}::${item.sk}`;
        itemMap.set(key, item);
      }
      
      // Add reverse relationships (avoid duplicates)
      for (const item of reverseItems) {
        const key = `${item.pk}::${item.sk}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, item);
        }
      }
      
      items = Array.from(itemMap.values());
      logger.info(`Total unique relationships after merge: ${items.length}`);
    }

    // Optionally expand relationships with entity data
    if (expand) {
      logger.info(`Expanding ${items.length} relationships with entity data`);
      items = await expandRelationships(items, bidirectional, pk);
    }

    return sendResponse(200, {
      items: items,
      count: items.length,
    });
  } catch (error) {
    return sendResponse(Number(error?.code) || 500, {
      error: "Failed to get relationships",
      message: error.message,
    });
  }
};
