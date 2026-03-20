const { logger, sendResponse, Exception } = require("/opt/base");
const { fetchInventoryPoolsOnDate } = require("../methods");

exports.handler = async (event, context) => {
  logger.info("GET InventoryPool by Product on Date", event);
  try {

    // Validate required parameters from path and queryparams

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;
    const date = event?.queryStringParameters?.date;

    if (!collectionId || !activityType || !activityId || !productId || !date) {
      throw new Exception("Missing required path parameters: collectionId, activityType, activityId, productId, date");
    }

    // Validate optional parameters
    const facilityType = event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.queryStringParameters?.facilityId || null;
    const assetType = event?.queryStringParameters?.assetType || null;
    const assetId = event?.queryStringParameters?.assetId || null;
    const inventoryId = event?.queryStringParameters?.inventoryId || null;
    const allocationStatus = event?.queryStringParameters?.allocationStatus || null;
    const limit = event?.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : null;

    const inventoryPools = await fetchInventoryPoolsOnDate({ collectionId, activityType, activityId, productId, date, facilityType, facilityId, assetType, assetId, inventoryId, allocationStatus, limit });

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