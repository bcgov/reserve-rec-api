// Await Worldline Notification push
const querystring = require('querystring');
const { Exception, logger, sendResponse } = require("/opt/base");
const { updateTransaction } = require("../../transactions/methods");
const { batchTransactData, TABLE_NAME } = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { TRANSACTION_UPDATE_CONFIG } = require("../../transactions/configs");

const WORLDLINE_WEBHOOK_SECRET = process.env.WORLDLINE_WEBHOOK_SECRET || 'default-secret'

// Update booking
const { confirmBooking } = require("../../bookings/methods")
const { BOOKING_UPDATE_CONFIG } = require("../../bookings/configs");

exports.handler = async (event, context) => {
  logger.info("Worldline Notification POST:", event);

  try {
    // Get relevant data from the event
    const secret = event?.queryStringParameters?.webhookSecret;
    
    // Take the body and convert into a JSON object
    const rawFormBody = event.body.replace(/^body:\s*'/, '').replace(/'$/, '');
    const body = querystring.parse(rawFormBody);

    const clientTransactionId = body?.trnOrderNumber
    const bookingId = body?.ref1
    const sessionId = body?.ref2

    if (!secret || !bookingId || !sessionId || !clientTransactionId ) {
      throw new Exception("Missing required transaction fields", { code: 400 });
    }
    
    // Protect from any POST requests to endpoint
    if (secret !== WORLDLINE_WEBHOOK_SECRET) {
      throw new Exception("Incorrect webhook secret", { code: 400 });
    }

    const updateRequestsTransaction = await updateTransaction(clientTransactionId, bookingId, sessionId, body);

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
