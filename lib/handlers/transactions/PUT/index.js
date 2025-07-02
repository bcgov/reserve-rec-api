// Update transaction
const { Exception, logger, sendResponse } = require("/opt/base");
const { updateTransaction } = require("/opt/transactions/methods");
const { batchTransactData, TABLE_NAME } = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { TRANSACTION_UPDATE_CONFIG } = require("/opt/transactions/configs");

// Update booking
const { confirmBooking } = require("/opt/bookings/methods")
const { BOOKING_UPDATE_CONFIG } = require("/opt/bookings/configs");

exports.handler = async (event, context) => {
  logger.info("Transactions PUT:", event);

  try {
    // Get relevant data from the event
    const queryParams = event?.queryStringParameters;

    const clientTransactionId = queryParams?.trnOrderNumber;
    const bookingId = queryParams?.ref1;
    const sessionId = queryParams?.ref2;

    if (!clientTransactionId || !bookingId || !sessionId) {
      throw new Exception("Missing required transaction items", { code: 400 });
    }

    const updateRequestsTransaction = await updateTransaction(clientTransactionId, bookingId, sessionId, queryParams);

    const putItemsTransactions = await quickApiUpdateHandler(
      TABLE_NAME,
      [updateRequestsTransaction],
      TRANSACTION_UPDATE_CONFIG
    );

    const resTransaction = await batchTransactData(putItemsTransactions);

    // TODO: Configure a better setup for retries and/or error handling
    
    // If the transaction successfully updates to "paid", confirm the booking now
    const updateRequestsBooking = await confirmBooking(bookingId, sessionId);

    const putItemsBooking = await quickApiUpdateHandler(
      TABLE_NAME,
      [updateRequestsBooking],
      BOOKING_UPDATE_CONFIG
    );

    const resBooking = await batchTransactData(putItemsBooking);

    const response = {
      res: resBooking,
      transaction: updateRequestsTransaction,
      booking: updateRequestsBooking,
    }

    return sendResponse(
      200,
      { response },
      "Success",
      null,
      context
    );
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
