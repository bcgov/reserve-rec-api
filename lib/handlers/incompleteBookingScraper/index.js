const { logger } = require("../../helpers/utils");
const {
  TRANSACTIONAL_DATA_TABLE_NAME,
  marshall,
  batchTransactData,
  getOne,
} = require("/opt/dynamodb");
const { getExpiredBookings } = require("../../../src/handlers/bookings/methods");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const AWS_REGION = process.env.AWS_REGION || "ca-central-1";
const sqsClient = new SQSClient({ region: AWS_REGION });

exports.handler = async (event, context) => {
  logger.info("Scraping for expired Booking sessions:", event);

  // Pulling bookings where isPending is PENDING and sessionExpiry is past
  const expiredBookings = await getExpiredBookings();

  logger.info(`Found ${expiredBookings?.items?.length || 0} expired Booking sessions`);

  if (!expiredBookings?.items || expiredBookings.items.length === 0) {
    logger.info("No expired Booking sessions found. Exiting.");
    return;
  }

  logger.debug(`Expired Bookings: ${JSON.stringify(expiredBookings)}`);

  for (const projectedBooking of expiredBookings.items) {
    logger.debug('projectedBooking', projectedBooking);
    try {
      // The sparse GSI projection only contains booking keys and expiry attributes,
      // which is why we make a getOne call after to fetch for the full booking
      // TODO: something to make the sparse GSI more robust is to maybe have it
      //       be built off the "status" attribute instead of the isPending attribute
      const booking = await getOne(
        projectedBooking.pk, 
        projectedBooking.sk, 
        TRANSACTIONAL_DATA_TABLE_NAME
      );

      if (!booking) {
        logger.warn(`Could not load booking ${projectedBooking.bookingId} from the transactional table`);
        continue;
      }

      // Looking for booking statuses with cancelled, TIMED_OUT, or in progress + expired
      const isCancelled = booking.status === "cancelled";
      const isTimedOut = booking.status === "TIMED_OUT";
      const isExpiredInProgress = booking.status === "in progress"
        && Number(booking.sessionExpiry) < Date.now();

      // If you're not cancelled, TIMED_OUT, or in progress + expired, get out of here
      if (!isCancelled && !isTimedOut && !isExpiredInProgress) {
        logger.info(`Skipping expired booking ${booking.bookingId} with status ${booking.status}`);
        continue;
      }

      // Before sending to SQS, we want to flip "in progress" to be TIMED_OUT bookings
      if (isExpiredInProgress) {
        const timeoutRequest = {
          TableName: TRANSACTIONAL_DATA_TABLE_NAME,
          Key: {
            pk: marshall(booking.pk),
            sk: marshall(booking.sk),
          },
          UpdateExpression: "SET #status = :timedOut",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":timedOut": { S: "TIMED_OUT" },
            ":inProgress": { S: "in progress" },
          },
          ConditionExpression: "attribute_exists(isPending) AND #status = :inProgress",
        };

        // Update the booking accordingly to be TIMED_OUT
        await batchTransactData([{ data: timeoutRequest, action: "Update" }]);
        booking.status = "TIMED_OUT";
      }

      await queueInventoryReturn(booking);
      logger.info(`Queued inventory return for ${booking.status} booking ${booking.bookingId}`);
    } catch (error) {
      logger.error(`Error queueing inventory return for booking ${projectedBooking.bookingId}:`, error);
    }
  }
};

// Send the booking to the inventory return queue
async function queueInventoryReturn(booking) {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.INVENTORY_RETURN_QUEUE_URL,
      MessageBody: JSON.stringify({
        bookingId: booking.bookingId,
        pk: booking.pk,
        sk: booking.sk,
        collectionId: booking.collectionId,
        activityType: booking.activityType,
        activityId: booking.activityId,
        productId: booking.productId,
        invQuantity: booking.invQuantity,
        startDate: booking.startDate,
        endDate: booking.endDate,
        asset: booking.asset,
        cancellationReason:
          booking.cancellationReason
          || (booking.status === "TIMED_OUT"
            ? "Booking session timed out"
            : "Booking cancelled"),
      }),
    }),
  );
}
