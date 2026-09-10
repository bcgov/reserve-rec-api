const { logger, sendResponse, Exception } = require("/opt/base");
const { fetchInventoryPoolsOnDate, fetchInventoryPoolsForDateRange } = require("../methods");
const { PUBLIC_INVENTORYPOOL_PROJECTIONS } = require("../configs");

/**
 * @api {get} /inventory-pools/{collectionId}/{activityType}/{activityId}/{productId} GET (public)
 * Fetch inventory pool data for a product on a specific date.
 * Returns only isOpen and available fields (see PUBLIC_INVENTORYPOOL_PROJECTIONS).
 */
exports.handler = async (event, context) => {
  logger.info("GET InventoryPool by Product on Date (public)", event);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: ''
    };
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;
 
    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Missing required path parameters: collectionId, activityType, activityId, productId", { code: 400 });
    }

    // Support both single date and date range queries
    // If 'date' is provided, use it for both startDate and endDate (single day query)
    // Otherwise use startDate and endDate for range queries
    let startDate = event?.queryStringParameters?.date || event?.queryStringParameters?.startDate || null;
    let endDate = event?.queryStringParameters?.date || event?.queryStringParameters?.endDate || null;

    if (!startDate || !endDate) {
      throw new Exception("Must provide either 'date' for a single date or 'startDate' and 'endDate' for a date range", { code: 400 });
    }

    // Enforce maximum date range of 1 month to prevent excessively large queries
    const start = new Date(startDate);
    const end = new Date(endDate);
    const maxEndDate = new Date(start);
    maxEndDate.setMonth(maxEndDate.getMonth() + 1);

    if (end > maxEndDate) {
      logger.warn(`End date ${endDate} is more than 1 month after start date ${startDate}. Adjusting end date to 1 month ahead maximum.`);
      endDate = maxEndDate.toISOString().split('T')[0];
    }

    let inventoryPools = [];

    // Check if this is a single date query
    const date = startDate === endDate ? startDate : null;
    
    if (date) {
      logger.debug(`Single date query - fetching InventoryPool for ${collectionId}::${activityType}::${activityId}::${productId} on date ${date}`);
      inventoryPools = await fetchInventoryPoolsOnDate({
        bypassDiscoveryRules: false, // Discovery rules are ALWAYS applied for the public handler
        collectionId,
        activityType,
        activityId,
        productId,
        date,
        projectionFields: PUBLIC_INVENTORYPOOL_PROJECTIONS,
      });
    } else {
      logger.debug(`Range query - fetching InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);
      inventoryPools = await fetchInventoryPoolsForDateRange({
        collectionId,
        activityType,
        activityId,
        productId,
        startDate,
        endDate,
        projectionFields: PUBLIC_INVENTORYPOOL_PROJECTIONS,
      });
    }

    // Extract only isOpen and available fields
    let response;
    
    if (date) {
      response = inventoryPools.length > 0 ? {
        isOpen: inventoryPools[0]?.isOpen ?? true,
        available: inventoryPools[0]?.availability ?? null
      } : {
        isOpen: true,
        available: null
      };
    } else {
      response = {};
      for (const pool of inventoryPools) {
        const poolDate = pool?.pk?.split('::')?.pop(); // Extract date from pk
        if (poolDate && poolDate >= startDate && poolDate <= endDate) {
          response[poolDate] = {
            isOpen: pool?.isOpen ?? true,
            available: pool?.availability ?? null
          };
        }
      }
    }

    logger.debug(`Returning inventory pool data: ${JSON.stringify(response)}`);
    return sendResponse(200, response, "Success", null, context);

  } catch (error) {
    logger.error("Error fetching InventoryPool", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
