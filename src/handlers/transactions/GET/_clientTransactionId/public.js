// Get transaction

const {
  Exception,
  logger,
  sendResponse,
  getRequestClaimsFromEvent,
  checkAuthContext,
} = require("/opt/base");
const {
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate,
  getTransactionByTransactionId,
} = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("Transactions user GET:", event);

  try {
    // Get the user sub from the authorizer context
    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!userId) {
      throw new Exception("Unauthorized: a valid userId is required", {
        code: 401,
      });
    }

    const params = event?.queryStringParameters || {};
    const bookingId = params.bookingId;
    const date = params.date;
    const clientTransactionId =
      params.clientTransactionId || event?.pathParameters?.clientTransactionId;

    if (clientTransactionId) {
      // Get a specific transaction using transactionId
      const transaction =
        await getTransactionByTransactionId(clientTransactionId);

      // Check user on transaction
      if (transaction.transaction.userId === userId) return transaction;
    } else if (bookingId && date && !clientTransactionId) {
      // Get all transaction created for a specific booking on a date
      const transactions = await getTransactionsByBookingIdDate(
        bookingId,
        date,
      );

      // Check user on all transactions
      validTransactions = [];
      for (const transaction of transactions) {
        if (transaction.transaction.userId === userId) validTransactions.push(transaction);
      }

      return validTransactions;
    } else if (bookingId && !date && !clientTransactionId) {
      // Get all transactions created for a specific booking
      const transactions = await getTransactionsByBookingId(bookingId);

      // Check user on all transactions
      validTransactions = [];
      for (const transaction of transactions) {
        if (transaction.transaction.userId === userId) validTransactions.push(transaction);
      }

      return validTransactions;
    } else {
      throw new Exception(
        "Invalid: missing bookingId, date, and/or clientTransactionId",
        { code: 400 },
      );
    }
  } catch (error) {
    logger.error("Error in transactions GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context,
    );
  }
};
