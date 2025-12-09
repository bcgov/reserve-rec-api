// SNS Subscriber for Booking Cancellations
// This handler is triggered by SNS messages for booking cancellations
const { Exception, logger, getNow } = require("/opt/base");
const { batchTransactData, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("../../../src/common/data-utils");
const { BOOKING_UPDATE_CONFIG } = require("../../../src/handlers/bookings/configs");
const { getBookingByBookingId, refundPublishCommand } = require("../../../src/handlers/bookings/methods");

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
