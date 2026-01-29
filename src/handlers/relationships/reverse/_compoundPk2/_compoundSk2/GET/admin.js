const { getRelationshipsByGsipk, expandRelationships } = require("../../../../methods");
const { Exception, logger, sendResponse } = require("/opt/base");

/**
 * GET /relationships/reverse/{pk2}/{sk2}
 * 
 * Query all relationships TO a target entity (reverse direction via GSI)
 * Returns all entities that are related to the target
 * 
 * @param pk2 - Full partition key of target entity (e.g., 'facility::bcparks_250')
 * @param sk2 - Sort key of target entity (e.g., 'campground::camping')
 * @param sourceSchema - Optional query param to filter by source schema
 * 
 */
exports.handler = async (event, context) => {
  logger.info('GET Relationships To (Reverse)', event);

  const pk2 = event?.pathParameters?.pk2;
  const sk2 = event?.pathParameters?.sk2;
  const sourceSchema = event?.queryStringParameters?.sourceSchema || null;
  const expand = event?.queryStringParameters?.expand === 'true';

  // Validate required parameters
  const missingParams = [];
  if (!pk2) missingParams.push("pk2");
  if (!sk2) missingParams.push("sk2");

  if (missingParams.length > 0) {
    throw new Exception(
      `Cannot get reverse relationships - missing required parameter(s): ${missingParams.join(", ")}`,
      { code: 400 }
    );
  }

  // Construct the GSI pk for reverse querying
  const gsipk = `rel::${pk2}::${sk2}`;
  logger.info(`Querying reverse relationships with gsipk: ${gsipk}, sourceSchema: ${sourceSchema}`);

  try {
    // Get reverse relationships using GSI
    const res = await getRelationshipsByGsipk(gsipk, sourceSchema);
    let items = res.items || [];

    // Expand full entity data if requested
    if (expand && items.length > 0) {
      items = await expandRelationships(items, 'source'); // Expand source entities for reverse relationships
    }

    return sendResponse(200, { items, count: items.length }, "Success", null, context);
  } catch (error) {
    logger.error('Error querying reverse relationships:', error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error querying reverse relationships",
      null,
      context
    );
  }
};
