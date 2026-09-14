// SQS Processor for Inventory Return Requests
// This handler processes inventory return requests from cancelled bookings.
// It validates whether inventory can be returned to the availability pool
// or needs to be retired based on business rules.
const { logger, getNow, getNowEpoch } = require("/opt/base");
const {
  runQuery,
  getOne, // Added getOne
  batchTransactData,
  REFERENCE_DATA_TABLE_NAME,
  TRANSACTIONAL_DATA_TABLE_NAME,
  marshall,
} = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("../../../src/common/data-utils");

// Inventory allocation status constants (For Granular Inventory Items)
const INVENTORY_STATUS = {
  AVAILABLE: "available",
  HELD: "held",
  RESERVED: "reserved",
  RELEASING: "releasing",
  RETIRED: "retired",
};

// Inventory update configuration
const INVENTORY_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    allocationStatus: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        if (
          !["available", "held", "reserved", "releasing", "retired"].includes(
            value,
          )
        ) {
          throw new Error(`Invalid allocation status: ${value}`);
        }
      },
    },
    returnedAt: {},
    returnReason: {},
    relatedBookingId: {},
  },
};

/**
 * Validates whether Granular Inventory items can be returned.
 */
async function validateInventoryReturn(inventory, booking) {
  const now = getNow();
  const inventoryDate = new Date(inventory.date + "T00:00:00.000Z");
  const today = new Date(now.toISO().split("T")[0] + "T00:00:00.000Z");

  // Check 1: Date has not passed
  if (inventoryDate < today) {
    return {
      canReturn: false,
      reason: `Inventory date ${inventory.date} has already passed`,
    };
  }

  // Check 2: Inventory must be in a returnable state (reserved or releasing)
  if (
    inventory.allocationStatus !== INVENTORY_STATUS.RESERVED &&
    inventory.allocationStatus !== INVENTORY_STATUS.RELEASING
  ) {
    return {
      canReturn: false,
      reason: `Inventory is in ${inventory.allocationStatus} state, not eligible for return`,
    };
  }

  // Check 3: Asset is still active (if we have asset reference)
  // Note: Full asset validation would require fetching the asset record
  // For now, we trust the assetRef and version
  if (!inventory.assetRef) {
    return {
      canReturn: false,
      reason: "Inventory has no asset reference",
    };
  }

  // All checks passed
  return {
    canReturn: true,
    reason: "Inventory eligible for return to availability pool",
  };
}

/**
 * Validates whether an InventoryPool record should be incremented.
 * Pool records must exist in the database and not be in the past.
 */
function validateInventoryPoolReturn(inventoryPoolItem, dateStr) {
  if (!inventoryPoolItem) {
    throw new Error(`Inventory pool record for date ${dateStr} not found in database.`);
  }

  const now = getNow();
  const poolDate = new Date(dateStr + "T00:00:00.000Z");
  const today = new Date(now.toISO().split("T")[0] + "T00:00:00.000Z");

  if (poolDate < today) {
    return {
      canReturn: false,
      reason: `Booking date ${dateStr} has already passed`,
    };
  }

  return { canReturn: true, reason: "Eligible for return" };
}

/**
 * Fetches granular inventory records associated with a booking.
 */
async function getInventoryForBooking(booking) {
  const {
    collectionId,
    activityType,
    activityId,
    startDate,
    endDate,
    bookingId,
  } = booking;

  // Query for inventory that was allocated to this booking
  // Inventory pk format: inventory::<collectionId>::<activityType>::<activityId>::<productId>::<date>
  // We need to query across the date range

  const inventoryItems = [];

  // Parse dates to iterate through the booking date range
  const start = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T00:00:00.000Z");

  // Loop through inclusive date range (d <= end)
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];

    // Query for inventory on this date that references this booking
    const query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      FilterExpression: "relatedBookingId = :bookingId",
      ExpressionAttributeValues: {
        ":pk": marshall(
          `inventory::${collectionId}::${activityType}::${activityId}::${dateStr}`,
        ),
        ":bookingId": marshall(bookingId),
      },
    };

    try {
      const result = await runQuery(query);
      if (result && result.length > 0) {
        inventoryItems.push(...result);
      }
    } catch (error) {
      logger.error(`Failed to query inventory for date ${dateStr}:`, error);
      throw error;
    }
  }

  return inventoryItems;
}

/**
 * Returns inventory to the available state.
 */
function createInventoryReturnUpdate(inventory, reason) {
  return {
    key: {
      pk: inventory.pk,
      sk: inventory.sk,
    },
    data: {
      allocationStatus: { value: INVENTORY_STATUS.AVAILABLE, action: "set" },
      returnedAt: { value: getNow().toISO(), action: "set" },
      returnReason: { value: reason, action: "set" },
      relatedBookingId: { value: null, action: "remove" },
    },
  };
}

/**
 * Retires inventory (marks as no longer available).
 */
function createInventoryRetireUpdate(inventory, reason) {
  return {
    key: {
      pk: inventory.pk,
      sk: inventory.sk,
    },
    data: {
      allocationStatus: { value: INVENTORY_STATUS.RETIRED, action: "set" },
      returnedAt: { value: getNow().toISO(), action: "set" },
      returnReason: { value: reason, action: "set" },
    },
  };
}

/**
 * 
 * Returns a batchTransaction data item to remove isPending from a booking,
 * as well as setting some inventoryProcessing items for data tracking (as needed).
 * 
 * @param {Object} booking 
 * @param {Object} returnResults 
 * @returns 
 */
function clearPendingAndUpdateBooking(booking, returnResults) {
  const status = getInventoryProcessingStatus(returnResults);
  const processedAt = getNowEpoch();

  const updateParts = [
    "REMOVE isPending",
    "SET invProcessingStatus = :status, invProcessedAt = :processedAt",
  ];

  const expressionAttributeValues = {
    ":status": marshall(status),
    ":processedAt": marshall(processedAt),
  };

  if (returnResults.returned > 0) {
    updateParts[1] += ", invReturnedCount = :returned";
    expressionAttributeValues[":returned"] = marshall(returnResults.returned,);
  }

  if (returnResults.retired > 0) {
    updateParts[1] += ", invRetiredCount = :retired";
    expressionAttributeValues[":retired"] = marshall(returnResults.retired,);
  }

  if (returnResults.skipped > 0) {
    updateParts[1] += ", invSkippedCount = :skipped";
    expressionAttributeValues[":skipped"] = marshall(returnResults.skipped,);
  }

  const updateCommand = {
    TableName: TRANSACTIONAL_DATA_TABLE_NAME,
    Key: {
      pk: marshall(booking.pk || `booking::${booking.bookingId}`),
      sk: marshall(booking.sk || `booking::${booking.bookingId}`),
    },
    UpdateExpression: updateParts.join(" "),
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: "attribute_exists(isPending)",
  };

  return updateCommand;
}

/**
 * Checks if a DynamoDB transaction cancellation was caused by a ConditionalCheckFailed
 * error on the booking record (indicating `isPending` was already removed).
 * 
 * @param {Error} error - The error caught from the transaction attempt.
 * @returns {boolean} True if the error was due to the booking already being processed.
 */
function isBookingAlreadyProcessedError(error) {
  const cancellationReasons = error?.CancellationReasons || error?.cancellationReasons;
  const bookingReason = cancellationReasons?.[cancellationReasons.length - 1];
  return error?.name === "TransactionCanceledException"
    && bookingReason?.Code === "ConditionalCheckFailed";
}

/**
 * Make sure we're not updating more than 100 items
 * 
 * @param {Array} items 
 */
function assertTransactionSize(items) {
  if (items.length > 100) {
    throw new Error(`Inventory return transaction contains ${items.length} items; dynamo supports at most 100`);
  }
}

/**
 * Commits inventory updates and booking status changes together in a single atomic transaction.
 * 
 * @param {Object} booking - The booking record object.
 * @param {Array<Object>} updates - Array of inventory transaction update objects.
 * @param {Object} returnResults - Object tracking returned, retired, and skipped counts.
 * @returns {Promise<boolean>} True if transaction succeeded; false if skipped due to prior processing.
 */
async function commitInventoryReturn(booking, updates, returnResults) {
  const clearBooking = clearPendingAndUpdateBooking(booking, returnResults);
  const transactionItems = [
    ...updates,
    { data: clearBooking, action: "Update" },
  ];
  assertTransactionSize(transactionItems);

  try {
    await batchTransactData(transactionItems);
    return true;
  } catch (error) {
    if (isBookingAlreadyProcessedError(error)) {
      logger.info(`Skipping already-processed booking ${booking.bookingId}`);
      return false;
    }
    throw error;
  }
}

/**
 * Determines the overall inventory processing status string based on outcome counts.
 * 
 * @param {Object} counts - Object containing { returned, retired, skipped }.
 * @returns {string} Status code: "returned", "retired", "partially_returned", "skipped", or "processed".
 */
function getInventoryProcessingStatus({ returned, retired, skipped }) {
  if (returned > 0 && retired === 0 && skipped === 0) {
    return "returned";
  }

  if (returned === 0 && retired > 0 && skipped === 0) {
    return "retired";
  }

  if (returned > 0 && (retired > 0 || skipped > 0)) {
    return "partially_returned";
  }

  if (returned === 0 && skipped > 0) {
    return "skipped";
  }

  return "processed";
}

/**
 * Evaluates individual inventory items to determine if they should be returned or retired,
 * builds update operations, and commits them alongside the booking update.
 * 
 * @param {Object} booking - The booking record.
 * @param {Array<Object>} inventoryItems - Granular inventory items found for the booking.
 * @param {Array<Object>} updateOperations - Target array to accumulate updates into.
 * @param {Object} returnResults - Object tracking returned, retired, and skipped counts.
 * @returns {Promise<Array<Object>>} The applied update operations, or empty array if skipped.
 */
async function processInventoryReturns(
  booking,
  inventoryItems,
  updateOperations,
  returnResults,
) {
  // Process each inventory item
  for (const inventory of inventoryItems) {
    const validation = await validateInventoryReturn(inventory, booking);

    if (validation.canReturn) {
      // Return to availability pool
      const returnUpdate = createInventoryReturnUpdate(
        inventory,
        booking.cancellationReason || "Booking cancelled",
      );
      updateOperations.push(returnUpdate);
      // Increment each inventory item return attempt
      returnResults.returned++;
      logger.debug(`Inventory ${inventory.globalId} will be returned to pool`);
    } else {
      // Retire the inventory
      const retireUpdate = createInventoryRetireUpdate(
        inventory,
        validation.reason,
      );
      updateOperations.push(retireUpdate);
      // Increment each inventory item retire attempt
      returnResults.retired++;
      logger.debug(
        `Inventory ${inventory.globalId} will be retired: ${validation.reason}`,
      );
    }
  }

  // Execute all inventory updates
  if (updateOperations.length > 0) {
    const updateItems = await quickApiUpdateHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      updateOperations,
      INVENTORY_UPDATE_CONFIG,
    );

    const committed = await commitInventoryReturn(booking, updateItems, returnResults);
    if (!committed) {
      return [];
    }
    logger.info(
      `Processed ${updateOperations.length} inventory updates for booking ${booking.bookingId}`,
    );
  }

  return updateOperations;
}

/**
 * Processes capacity returns for aggregate inventory pool records across the booking date range,
 * committing capacity increments and the booking update in a single transaction.
 * 
 * @param {Object} booking - The booking record item.
 * @param {Object} returnResults - Mutated in-place to track returned and skipped quantities.
 * @returns {Promise<void>}
 */
async function processInventoryPoolReturns(booking, returnResults) {
  const {
    collectionId,
    activityType,
    activityId,
    productId,
    startDate,
    endDate,
    asset,
    bookingId,
  } = booking;

  // Validate quantity
  const quantity = Number(booking.invQuantity ?? 1);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(
      `Cannot return inventory for booking ${bookingId}: invalid quantity ${booking.invQuantity}`
    );
  }

  const start = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T00:00:00.000Z");

  const assetPk = asset?.primaryKey?.pk ?? asset?.pk;
  const assetSk = asset?.primaryKey?.sk ?? asset?.sk;

  const assetPkSk = assetPk && assetSk ? `${assetPk}::${assetSk}` : null;
  const assetKey = typeof asset === "string" ? asset : assetPkSk;

  // Validate asset key
  if (!assetKey) {
    throw new Error(
      `Cannot return inventory for booking ${bookingId}: missing asset key`
    );
  }

  const poolUpdates = [];

  // Loop through inclusive date range (d <= end)
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const poolPk = `inventoryPool::${collectionId}::${activityType}::${activityId}::${productId}::${dateStr}`;
    
    // Throws automatically if DynamoDB query or throttle fails
    const inventoryPoolItem = await getOne(
      poolPk,
      assetKey,
      REFERENCE_DATA_TABLE_NAME,
    );

    const validation = validateInventoryPoolReturn(inventoryPoolItem, dateStr);
    if (!validation.canReturn) {
      returnResults.skipped += quantity;
      logger.info(
        `Inventory pool capacity not returned for ${dateStr}: ${validation.reason}`,
      );
      continue;
    }

    const capacity = Number(inventoryPoolItem.capacity);
    const maxAvailability = capacity - quantity;
    poolUpdates.push({
      data: {
        TableName: REFERENCE_DATA_TABLE_NAME,
        Key: {
          pk: { S: poolPk },
          sk: { S: assetKey },
        },
        UpdateExpression: "ADD availability :availability",
        ConditionExpression:
          "attribute_exists(pk) AND attribute_exists(availability) AND availability <= :maxAvailability",
        ExpressionAttributeValues: {
          ":availability": { N: quantity.toString() },
          ":maxAvailability": { N: maxAvailability.toString() },
        },
      },
      action: "Update",
    });
    returnResults.returned += quantity;
  }

  const committed = await commitInventoryReturn(booking, poolUpdates, returnResults);
  if (!committed) {
    returnResults.returned = 0;
    returnResults.skipped = 0;
    return;
  }

  logger.info(
    `Successfully returned ${returnResults.returned} inventory capacity for booking ${bookingId}`,
  );
}

exports.handler = async (event, context) => {
  logger.info("Inventory Return Processor:", event);

  try {
    const records = event.Records || [];
    const results = [];

    for (const record of records) {
      if (record.eventSource !== 'aws:sqs') {
        logger.warn('Skipping non-SQS record:', record);
        continue;
      }

      const message = JSON.parse(record.body);
      const {
        bookingId,
        pk,
        sk,
        collectionId,
        activityType,
        activityId,
        productId,
        invQuantity,
        startDate,
        endDate,
        asset,
        cancellationReason,
      } = message;

      logger.info(`Processing inventory return for booking: ${bookingId}`);

      // Build booking object for inventory lookup
      const booking = {
        bookingId,
        pk,
        sk,
        collectionId,
        activityType,
        activityId,
        productId,
        invQuantity,
        startDate,
        endDate,
        asset,
        cancellationReason,
      };

      const updateOperations = [];
      const returnResults = {
        returned: 0,
        retired: 0,
        skipped: 0,
      };

      // Attempt to fetch inventory associated with this booking
      const inventoryItems = await getInventoryForBooking(booking);

      // If there are inventory items, we need to remove the user from them
      // TODO: this might need to be reconsidered if it's supposed to be an if/else
      //       or if there will be times that inventory needs to be returned AND the
      //       inventory pool needs to be updated (might be the case post-DUP)
      if (inventoryItems.length !== 0) {
        logger.info(
          `Found ${inventoryItems.length} inventory items for booking ${bookingId}`,
        );
        await processInventoryReturns(
          booking,
          inventoryItems,
          updateOperations,
          returnResults,
        );
      } else {
        // If there's no inventory item, then we simply need to increment the
        // inventoryPool's availability
        logger.info(`Checking inventoryPool`);
        await processInventoryPoolReturns(
          booking,
          returnResults,
        );
      }

      results.push({
        bookingId,
        status: "processed",
        inventoryCount: inventoryItems.length,
        ...returnResults,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Inventory returns processed",
        results,
      }),
    };
  } catch (error) {
    logger.error("Error processing inventory return:", error);
    // Rethrow error so SQS treats message as failed and triggers retry policy
    throw error;
  }
};
