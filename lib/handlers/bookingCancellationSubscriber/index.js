// SNS Subscriber for Booking Cancellations
// This handler is triggered by SNS messages for booking cancellations
const { Exception, logger, getNow } = require("/opt/base");
const { batchTransactData, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { quickApiUpdateHandler } = require("../../../src/common/data-utils");
const { BOOKING_UPDATE_CONFIG } = require("../../../src/handlers/bookings/configs");
const { getBookingByBookingId, refundPublishCommand } = require("../../../src/handlers/bookings/methods");

const INVENTORY_RETURN_QUEUE_URL = process.env.INVENTORY_RETURN_QUEUE_URL;

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'ca-central-1',
  endpoint: process.env.SQS_ENDPOINT_URL,
  credentials: process.env.IS_OFFLINE ? {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy'
  } : undefined
});

exports.handler = async (event, context) => {
  logger.info("Booking Cancellation Subscriber:", event);

  try {
    const records = event.Records || [];
    const results = [];

    for (const record of records) {
      if (record.EventSource !== 'aws:sns') {
        logger.warn('Skipping non-SNS record:', record);
        continue;
      }

      // Extract message details, expected to contain bookingId, userId, and reason
      const message = JSON.parse(record.Sns.Message);
      const { bookingId, userId, reason } = message;

      logger.info(`Processing cancellation for booking: ${bookingId}`);

      // Fetch the booking to verify it exists and is cancellable
      const booking = await getBookingByBookingId(bookingId);
      
      // Verify ownership
      if (booking.userId !== userId) {
        throw new Exception(`userId ${userId} does not own booking ${booking.bookingId}`, {
          code: 403,
        });
      }
  
      // Check if booking is already cancelled
      if (booking.bookingStatus === "cancelled") {
        logger.info(`Booking ${booking.bookingId} is already cancelled - treating as success`);
        results.push({
          bookingId,
          status: 'already_cancelled',
          clientTransactionId: booking.clientTransactionId
        });
        continue;
      }

      // Check if booking is in a cancellable state
      const cancellableStatuses = ['in progress', 'confirmed'];
      if (!cancellableStatuses.includes(booking.bookingStatus)) {
        throw new Exception(
          `Booking ${booking.bookingId} has status "${booking.bookingStatus}" and cannot be cancelled`,
          { code: 400 }
        );
      }

      // TODO: Add cancellation window validation when policy infrastructure is implemented
      // Should check booking.reservationPolicySnapshot.temporalWindows.cancellationWindow
      // to determine if current time is within allowed cancellation period

    // Update the booking with cancellation details
    const updateData = {
      key: {
        pk: booking.pk,
        sk: booking.sk
      },
      data: {
        bookingStatus: { value: "cancelled", action: 'set' },
        cancellationReason: { value: reason, action: 'set' },
        cancelledAt: { value: getNow().toISO(), action: 'set' }
      }
    };

    logger.info('Updating booking', updateData);

    // Use quickApiUpdateHandler for updates (it uses UpdateItem instead of PutItem)
    const updateItems = await quickApiUpdateHandler(TRANSACTIONAL_DATA_TABLE_NAME, [updateData], BOOKING_UPDATE_CONFIG);
    
    await batchTransactData(updateItems);

      logger.info(`Booking ${booking.bookingId} cancelled successfully`);

      // Publish to refund topic if there's a transaction
      if (booking.clientTransactionId) {
        await refundPublishCommand(booking, reason);
      }

      // Queue inventory return request
      if (INVENTORY_RETURN_QUEUE_URL) {
        try {
          const inventoryReturnMessage = {
            bookingId: booking.bookingId,
            collectionId: booking.collectionId,
            activityType: booking.activityType,
            activityId: booking.activityId,
            startDate: booking.startDate,
            endDate: booking.endDate,
            cancellationReason: reason || 'Booking cancelled',
            timestamp: getNow().toISO()
          };

          const sendMessageCommand = new SendMessageCommand({
            QueueUrl: INVENTORY_RETURN_QUEUE_URL,
            MessageBody: JSON.stringify(inventoryReturnMessage),
            MessageAttributes: {
              bookingId: {
                DataType: 'String',
                StringValue: booking.bookingId,
              },
            },
          });

          const sqsResult = await sqsClient.send(sendMessageCommand);
          logger.info(`Queued inventory return request to SQS, MessageId: ${sqsResult.MessageId}`);
        } catch (sqsError) {
          // Log error but don't fail the cancellation - inventory return can be retried
          logger.error("Failed to queue inventory return request:", sqsError);
        }
      } else {
        logger.info("Inventory return queue not configured, skipping inventory return");
      }

      results.push({
        bookingId,
        status: 'cancelled',
        clientTransactionId: booking?.clientTransactionId || 'no transaction'
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Cancellations processed',
        results,
      }),
    };
  } catch (error) {
    logger.error("Error processing booking cancellation:", error);
    return {
      statusCode: Number(error?.code) || 500,
      body: JSON.stringify({
        message: error?.message || "Error processing cancellation",
        error: error?.error || error,
      }),
    };
  }
};
