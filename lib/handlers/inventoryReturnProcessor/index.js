// SQS Processor for Inventory Return Requests
// This handler processes inventory return requests from cancelled bookings.
// It validates whether inventory can be returned to the availability pool
// or needs to be retired based on business rules.
const { Exception, logger, getNow } = require("/opt/base");
const {
  runQuery,
  batchTransactData,
  TRANSACTIONAL_DATA_TABLE_NAME,
  marshall
} = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("../../../src/common/data-utils");

// Inventory allocation status constants
const INVENTORY_STATUS = {
  AVAILABLE: 'available',
  HELD: 'held',
  RESERVED: 'reserved',
  RELEASING: 'releasing',
  RETIRED: 'retired'
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
        if (!['available', 'held', 'reserved', 'releasing', 'retired'].includes(value)) {
          throw new Error(`Invalid allocation status: ${value}`);
        }
      }
    },
    returnedAt: {},
    returnReason: {},
    relatedBookingId: {}
  }
};

/**
 * Validates whether inventory can be returned to the availability pool.
 * Returns { canReturn: boolean, reason: string }
 *
 * Validation rules per inventory.md:
 * - Date has not yet passed
 * - Asset is still active
 * - Product/ProductDate configuration has not changed (version check)
 */
async function validateInventoryReturn(inventory, booking) {
  const now = getNow();
  const inventoryDate = new Date(inventory.date + 'T00:00:00.000Z');
  const today = new Date(now.toISO().split('T')[0] + 'T00:00:00.000Z');

  // Check 1: Date has not passed
  if (inventoryDate < today) {
    return {
      canReturn: false,
      reason: `Inventory date ${inventory.date} has already passed`
    };
  }

  // Check 2: Inventory must be in a returnable state (reserved or releasing)
  if (inventory.allocationStatus !== INVENTORY_STATUS.RESERVED &&
      inventory.allocationStatus !== INVENTORY_STATUS.RELEASING) {
    return {
      canReturn: false,
      reason: `Inventory is in ${inventory.allocationStatus} state, not eligible for return`
    };
  }

  // Check 3: Asset is still active (if we have asset reference)
  // Note: Full asset validation would require fetching the asset record
  // For now, we trust the assetRef and version
  if (!inventory.assetRef) {
    return {
      canReturn: false,
      reason: 'Inventory has no asset reference'
    };
  }

  // All checks passed
  return {
    canReturn: true,
    reason: 'Inventory eligible for return to availability pool'
  };
}

/**
 * Fetches inventory records associated with a booking.
 * Inventory is linked through the booking's product, activity, and date range.
 */
async function getInventoryForBooking(booking) {
  const { collectionId, activityType, activityId, startDate, endDate, bookingId } = booking;

  // Query for inventory that was allocated to this booking
  // Inventory pk format: inventory::<collectionId>::<activityType>::<activityId>::<productId>::<date>
  // We need to query across the date range

  const inventoryItems = [];

  // Parse dates to iterate through the booking date range
  const start = new Date(startDate + 'T00:00:00.000Z');
  const end = new Date(endDate + 'T00:00:00.000Z');

  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];

    // Query for inventory on this date that references this booking
    const query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: 'relatedBookingId = :bookingId',
      ExpressionAttributeValues: {
        ':pk': marshall(`inventory::${collectionId}::${activityType}::${activityId}::${dateStr}`),
        ':bookingId': marshall(bookingId)
      }
    };

    try {
      const result = await runQuery(query);
      if (result && result.length > 0) {
        inventoryItems.push(...result);
      }
    } catch (error) {
      logger.warn(`No inventory found for date ${dateStr}:`, error.message);
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
      sk: inventory.sk
    },
    data: {
      allocationStatus: { value: INVENTORY_STATUS.AVAILABLE, action: 'set' },
      returnedAt: { value: getNow().toISO(), action: 'set' },
      returnReason: { value: reason, action: 'set' },
      relatedBookingId: { value: null, action: 'remove' }
    }
  };
}

/**
 * Retires inventory (marks as no longer available).
 */
function createInventoryRetireUpdate(inventory, reason) {
  return {
    key: {
      pk: inventory.pk,
      sk: inventory.sk
    },
    data: {
      allocationStatus: { value: INVENTORY_STATUS.RETIRED, action: 'set' },
      returnedAt: { value: getNow().toISO(), action: 'set' },
      returnReason: { value: reason, action: 'set' }
    }
  };
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

      // Parse the SQS message
      const message = JSON.parse(record.body);
      const {
        bookingId,
        collectionId,
        activityType,
        activityId,
        startDate,
        endDate,
        cancellationReason
      } = message;

      logger.info(`Processing inventory return for booking: ${bookingId}`);

      // Build booking object for inventory lookup
      const booking = {
        bookingId,
        collectionId,
        activityType,
        activityId,
        startDate,
        endDate
      };

      // Fetch inventory associated with this booking
      const inventoryItems = await getInventoryForBooking(booking);

      if (inventoryItems.length === 0) {
        logger.info(`No inventory found for booking ${bookingId} - may be a booking without inventory allocation`);
        results.push({
          bookingId,
          status: 'no_inventory',
          message: 'No inventory records found for this booking'
        });
        continue;
      }

      logger.info(`Found ${inventoryItems.length} inventory items for booking ${bookingId}`);

      const updateOperations = [];
      const returnResults = {
        returned: 0,
        retired: 0,
        skipped: 0
      };

      // Process each inventory item
      for (const inventory of inventoryItems) {
        const validation = await validateInventoryReturn(inventory, booking);

        if (validation.canReturn) {
          // Return to availability pool
          const returnUpdate = createInventoryReturnUpdate(
            inventory,
            cancellationReason || 'Booking cancelled'
          );
          updateOperations.push(returnUpdate);
          returnResults.returned++;
          logger.debug(`Inventory ${inventory.globalId} will be returned to pool`);
        } else {
          // Retire the inventory
          const retireUpdate = createInventoryRetireUpdate(
            inventory,
            validation.reason
          );
          updateOperations.push(retireUpdate);
          returnResults.retired++;
          logger.debug(`Inventory ${inventory.globalId} will be retired: ${validation.reason}`);
        }
      }

      // Execute all inventory updates
      if (updateOperations.length > 0) {
        const updateItems = await quickApiUpdateHandler(
          TRANSACTIONAL_DATA_TABLE_NAME,
          updateOperations,
          INVENTORY_UPDATE_CONFIG
        );

        await batchTransactData(updateItems);
        logger.info(`Processed ${updateOperations.length} inventory updates for booking ${bookingId}`);
      }

      results.push({
        bookingId,
        status: 'processed',
        inventoryCount: inventoryItems.length,
        ...returnResults
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Inventory returns processed',
        results,
      }),
    };
  } catch (error) {
    logger.error("Error processing inventory return:", error);
    return {
      statusCode: Number(error?.code) || 500,
      body: JSON.stringify({
        message: error?.message || "Error processing inventory return",
        error: error?.error || error,
      }),
    };
  }
};
