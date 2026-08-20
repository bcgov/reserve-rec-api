const { logger, sendResponse, Exception } = require("/opt/base");
const { fetchInventoryPoolsOnDate, fetchInventoryPoolsForDateRange } = require("../methods");

exports.handler = async (event, context) => {
  logger.info("GET InventoryPool by Product on Date", event);

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

    // Validate required parameters from path and queryparams

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;
 
    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Missing required path parameters: collectionId, activityType, activityId, productId");
    }

    // Check if requesting by date range or single date
    const startDate = event?.queryStringParameters?.startDate || null;
    const endDate = event?.queryStringParameters?.endDate || null;
    const date = event?.queryStringParameters?.date || null;

    // Validate optional parameters
    const facilityType = event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.queryStringParameters?.facilityId || null;
    const assetType = event?.queryStringParameters?.assetType || null;
    const assetId = event?.queryStringParameters?.assetId || null;
    const inventoryId = event?.queryStringParameters?.inventoryId || null;
    const allocationStatus = event?.queryStringParameters?.allocationStatus || null;
    const limit = event?.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : null;

    let inventoryPools;

     if (startDate && endDate) {
      logger.debug(`Fetching InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);
      inventoryPools = await fetchInventoryPoolsForDateRange({ 
        collectionId, 
        activityType, 
        activityId, 
        productId, 
        startDate,
        endDate,
        facilityType, 
        facilityId, 
        assetType, 
        assetId, 
        inventoryId
      });
      logger.debug(`Fetched ${inventoryPools.length} InventoryPools from ${startDate} to ${endDate}`);
    } 
    // Otherwise, fetch for single date
    else if (date) {
      logger.debug(`Fetching InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} on date ${date}`);
      inventoryPools = await fetchInventoryPoolsOnDate({ 
        collectionId, 
        activityType, 
        activityId, 
        productId, 
        date, 
        facilityType, 
        facilityId, 
        assetType, 
        assetId, 
        inventoryId, 
        allocationStatus, 
        limit 
      });
      logger.debug(`Fetched ${inventoryPools.length} InventoryPools on date ${date}`);
    }
    // If neither date nor date range provided, throw error
    else {
      throw new Exception("Must provide either 'date' for a single date or 'startDate' and 'endDate' for a date range");
    }

    logger.debug(`Fetched InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} on date ${date}. ${inventoryPools.length} items found.`);

    return sendResponse(200, inventoryPools, "Success", null, context);

  } catch (error) {
    logger.error("Error fetching InventoryPools", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};