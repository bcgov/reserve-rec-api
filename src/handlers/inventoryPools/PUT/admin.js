const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { quickApiUpdateHandler } = require("../../../common/data-utils");
const { INVENTORYPOOLS_API_UPDATE_CONFIG } = require("../configs");
const { fetchInventoryPoolsOnDate } = require("../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /inventory-pools/{collectionId}/{activityType}/{activityId}/{productId} PUT
 * Update InventoryPool capacity and availability
 */
exports.handler = async (event, context) => {
  logger.info("PUT InventoryPool", event);
  
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'PUT,OPTIONS'
      },
      body: ''
    };
  }

  try {
    const authContext = checkAuthContext(event, "staff");

    // Extract path parameters
    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    // Extract query parameters
    const date = event?.queryStringParameters?.date;
    const editMode = event?.queryStringParameters?.editMode || 'bulk'; // 'manual' or 'bulk'

    // Parse body
    const body = JSON.parse(event?.body || '{}');
    const { capacity, notes } = body;

    // Validate required parameters
    const missingParams = [];
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");
    if (!productId) missingParams.push("productId");
    if (!date) missingParams.push("date");
    
    if (missingParams.length > 0) {
      throw new Exception(
        `Missing required parameters: ${missingParams.join(", ")}`,
        { code: 400 }
      );
    }

    // Validate that capacity is provided and is a valid non-negative number
    if (capacity === undefined || capacity === null || isNaN(capacity) || capacity < 0) {
      throw new Exception(
        "capacity must be a non-negative number",
        { code: 400 }
      );
    }

    logger.debug(`Fetching InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} on ${date}`);

    // Fetch existing inventory pools for this product and date
    const existingPools = await fetchInventoryPoolsOnDate({
      collectionId,
      activityType,
      activityId,
      productId,
      date
    });

    if (!existingPools || existingPools.length === 0) {
      throw new Exception(
        `No InventoryPool found for ${collectionId}::${activityType}::${activityId}::${productId} on ${date}`,
        { code: 404 }
      );
    }

    logger.debug(`Found ${existingPools.length} InventoryPool(s) for the date`);

    // Prepare update requests for all pools on this date
    // Calculate availability automatically based on capacity change
    const updateRequests = existingPools.map(pool => {
      const oldCapacity = pool.capacity || 0;
      const oldAvailability = pool.availability || 0;
      const capacityDelta = capacity - oldCapacity;
      
      // Calculate new availability: add/subtract the same delta as capacity
      let newAvailability = oldAvailability + capacityDelta;
      
      // Validate: availability cannot be negative
      if (newAvailability < 0) {
        throw new Exception(
          `Cannot reduce capacity below current bookings. Current availability would become negative: ${newAvailability}`,
          { code: 400 }
        );
      }
      
      // Validate: availability cannot exceed capacity
      if (newAvailability > capacity) {
        throw new Exception(
          `Availability cannot exceed capacity. Would result in overselling: availability=${newAvailability}, capacity=${capacity}`,
          { code: 400 }
        );
      }
      
      logger.debug(`Capacity change: ${oldCapacity} -> ${capacity} (delta: ${capacityDelta}), Availability change: ${oldAvailability} -> ${newAvailability}`);
      
      const updateData = {
        capacity: capacity,
        availability: newAvailability
      };
      
      // Add notes if provided
      if (notes !== undefined && notes !== null) {
        updateData.notes = notes;
      }
      
      // Set manuallyEdited flag based on editMode
      // Manual edits set the flag to true (create override badge)
      // Bulk edits set the flag to false (clear any existing override badge)
      if (editMode === 'manual') {
        updateData.manuallyEdited = true;
      } else {
        updateData.manuallyEdited = false;
      }
      
      return {
        key: {
          pk: pool.pk,
          sk: pool.sk
        },
        data: updateData
      };
    });

    logger.debug(`Update requests prepared:`, JSON.stringify(updateRequests, null, 2));
    logger.debug(`Config for validation:`, JSON.stringify(INVENTORYPOOLS_API_UPDATE_CONFIG, null, 2));

    // Use quickApiUpdateHandler to create the update items
    const updateItems = await quickApiUpdateHandler(
      REFERENCE_DATA_TABLE_NAME,
      updateRequests,
      INVENTORYPOOLS_API_UPDATE_CONFIG
    );

    logger.debug(`Prepared ${updateItems.length} update items for InventoryPools`);

    // Use batchTransactData to update the database
    await batchTransactData(updateItems);

    logger.info(`Successfully updated ${updateItems.length} InventoryPool records for ${collectionId}::${activityType}::${activityId}::${productId} on ${date}`);

    return sendResponse(
      200,
      updateRequests,
      `Successfully updated ${updateItems.length} InventoryPool records`,
      null,
      context
    );

  } catch (error) {
    logger.error("Error in PUT InventoryPool", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || error.message || "Error",
      error?.error || error,
      context
    );
  }
};