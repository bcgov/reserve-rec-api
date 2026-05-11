const { logger, sendResponse, Exception } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData, getOne, marshall } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("PUT Inventory Pools", event);

  // Allow Options
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;
    const date = event?.pathParameters?.date;

    if (!collectionId || !activityType || !activityId || !productId || !date) {
      throw new Exception("Missing required path parameters", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body?.assets || !Array.isArray(body.assets)) {
      throw new Exception("Request body must contain an 'assets' array", { code: 400 });
    }

    const pk = `inventoryPool::${collectionId}::${activityType}::${activityId}::${productId}::${date}`;

    // Build update requests for each asset
    const updateRequests = body.assets.map(async (asset) => {
      if (!asset.primaryKey?.pk || !asset.primaryKey?.sk) {
        logger.warn(`Asset missing primaryKey, skipping: ${JSON.stringify(asset)}`);
        return null;
      }

      const sk = `${asset.primaryKey.pk}::${asset.primaryKey.sk}`;
      const newCapacity = asset.quantity ?? 0;

      // Fetch the existing inventory pool
      const existingPool = await getOne(pk, sk);
      
      if (!existingPool) {
        logger.warn(`InventoryPool not found for ${pk}::${sk}, skipping`);
        return null;
      }

      // Merge updates - only change capacity and availability
      const updatedPool = {
        ...existingPool,
        capacity: newCapacity,
        availability: newCapacity,
        lastUpdated: new Date().toISOString()
      };

      // Return a Put request (replace the entire item)
      return {
        TableName: REFERENCE_DATA_TABLE_NAME,
        Item: marshall(updatedPool, { removeUndefinedValues: true })
      };
    });

    const requests = (await Promise.all(updateRequests)).filter(r => r !== null);

    if (requests.length === 0) {
      throw new Exception("No valid assets provided for update", { code: 400 });
    }

    logger.debug(`Updating ${requests.length} InventoryPools for ${productId} on ${date}`);

    const result = await batchTransactData(requests, 'Put');

    logger.info(`Successfully updated ${requests.length} InventoryPools for ${productId} on ${date}`);

    return sendResponse(200, result, `Successfully updated ${requests.length} InventoryPools`, null, context);

  } catch (error) {
    logger.error("Error in PUT Inventory Pools", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || error.message || "Error",
      error?.error || error,
      context
    );
  }
};
