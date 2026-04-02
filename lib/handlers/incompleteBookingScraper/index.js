const { logger } = require("../../helpers/utils");
const { TRANSACTIONAL_DATA_TABLE_NAME, marshall, batchTransactData, getOne, REFERENCE_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { getExpiredBookings, getBookingDatesByBookingId } = require("../../../src/handlers/bookings/methods");

/*

=== Description ===

This Lambda function is responsible for scraping for expired Booking sessions. It will be triggered on a schedule (e.g. every 15 mins) and will check for any Booking sessions that have expired but have not been completed or cancelled. For any such sessions, it can perform necessary cleanup actions, such as marking the session as expired, releasing any held inventory.

The Lambda will query a sparse GSI in the the transactional data table for any Bookings that are 'pending' and with a sessionExpiry timestamp that has passed. For each expired session found, it can update the Booking status to "timed out" and perform any additional cleanup logic as needed.

Since there may be hundreds of Bookings to process in a single run, the function should be designed to handle accurate chunking of transactions to ensure a single failed transaction does not have cascading effects on the rest of the batch. The function should also be idempotent, so that if it processes the same expired session multiple times (e.g. due to retries), it will not cause issues.

For each Booking session that is expired, the function will do the following:

1. Query for all BookingDates for each Booking.
2. For each BookingDate, get the associated held inventory quantity and the InventoryPool primary key.
3. To keep things simple - one transaction will contain 1 booking and all of the constituent inventoryPools that need updating. This provides an audit trail and idempotency at the booking level, but it will incur periods of heavy writing to inventory pools if there are many expired sessions at once. If this becomes an issue, we can look at optimizing by packaging updates to the same inventory pool, but this will require more complex orchestration and error handling to ensure data consistency.
*/

exports.handler = async (event, context) => {
  logger.info("Scraping for expired Booking sessions:", event);

  // === Get all expired Bookings ===

  const expiredBookings = await getExpiredBookings();

  logger.info(`Found ${expiredBookings?.items?.length || 0} expired Booking sessions`);

  if (!expiredBookings?.items || expiredBookings.items.length === 0) {
    logger.info("No expired Booking sessions found. Exiting.");
    return
  };

  logger.debug(`Expired Bookings: ${JSON.stringify(expiredBookings)}`);

  // === Process each expired Booking session ===

  for (const booking of expiredBookings?.items || []) {

    let updateItems = [];

    try {

      // === Get all BookingDates for the expired Booking ===

      const bookingDates = await getBookingDatesByBookingId(booking.bookingId);

      // === For each BookingDate, get the associated held inventory quantity and InventoryPool primary key ===

      for (const bookingDate of bookingDates?.items || []) {

        const inventoryPoolKey = formatInventoryPoolKey(bookingDate);

        // We need to get the InventoryPool so we know what the maximum capacity is, to ensure we don't add back more inventory than the maximum when we update availability

        const inventoryPool = await getOne(inventoryPoolKey.pk, inventoryPoolKey.sk);

        if (!inventoryPool) {
          logger.error(`Could not find InventoryPool for BookingDate ${bookingDate.bookingDateId} with key ${JSON.stringify(inventoryPoolKey)}. Skipping update for this BookingDate.`);
          continue;
        }

        const invQuantity = bookingDate?.quantity;
        const maxCapacity = inventoryPool?.capacity;

        // Create update request for this InventoryPool
        const updateRequest = {
          TableName: REFERENCE_DATA_TABLE_NAME,
          Key: {
            pk: marshall(inventoryPoolKey.pk),
            sk: marshall(inventoryPoolKey.sk),
          },
          UpdateExpression: 'ADD #availability :quantity',
          ExpressionAttributeValues: {
            ":quantity": { N: invQuantity.toString() },
            ":maximum": { N: (maxCapacity - invQuantity).toString() },
          },
          ExpressionAttributeNames: {
            "#availability": "availability",
          },
          ConditionExpression: '#availability <= :maximum', // Ensure we don't exceed capacity when adding back Inventory
        };

        updateItems.push(updateRequest);
      }

      // Create the update request for the Booking itself

      const bookingUpdateRequest = {
        TableName: TRANSACTIONAL_DATA_TABLE_NAME,
        Key: {
          pk: marshall(booking.pk),
          sk: marshall(booking.sk),
        },
        UpdateExpression: 'SET #status = :timedOut REMOVE isPending',
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":timedOut": { S: "TIMED_OUT" },
        },
        ConditionExpression: "attribute_exists(isPending)", // Only update if the booking is still pending, to ensure idempotency
      }

      updateItems.push(bookingUpdateRequest);

      // === Execute all updates in a single transaction ===

      logger.debug(`Updating expired Booking session ${booking.bookingId} and associated InventoryPools`);

      await batchTransactData(updateItems.map(item => ({ data: item, action: 'Update' })));

      logger.info(`Successfully processed expired Booking session ${booking.bookingId}`);


    } catch (error) {
      logger.error(`Error processing expired Booking session ${booking.bookingId}:`, error);
      // Continue processing the rest of the expired sessions, even if one fails
      continue;
    }
  }
}

function formatInventoryPoolKey(bookingDate) {
  // Logic to determine the InventoryPool primary key based on the BookingDate details
  try {

    // PK:

    const pkSuffix = bookingDate?.productDate?.pk.split('productDate::')[1];
    const pk = `inventoryPool::${pkSuffix}::${bookingDate.productDate?.sk}`;

    // SK:

    const sk = `${bookingDate?.asset?.pk}::${bookingDate?.asset?.sk}`;

    return {
      pk: pk,
      sk: sk,
    }

  } catch (error) {
    logger.error(`Error formatting InventoryPool key for BookingDate ${bookingDate.bookingId}`);
    throw error;
  }
}