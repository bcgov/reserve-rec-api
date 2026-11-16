// Get transaction

const {
  requestIdentity,
  Exception,
  logger,
  sendResponse,
  getRequestClaimsFromEvent,
  checkAuthContext,
} = require("/opt/base");
const {
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate,
  findAndVerifyTransactionOwnership,
} = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("Transactions user GET:", requestIdentity(event));

  try {
    // Get the user sub from the authorizer context
    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!userId) {
      throw new Exception("Unauthorized: a valid userId is required", {
        code: 401,
      });
    }

    const params = event?.queryStringParameters || {};
    const bookingId = params.bookingId || event?.pathParameters?.bookingId;
    const date = params.date;
    const clientTransactionId = params.clientTransactionId

    // Transactions are stored flat, so the owner is transaction.userId.
    if (clientTransactionId) {
      // Get a specific transaction; throws 404/401 if missing or not the caller's
      const transaction = await findAndVerifyTransactionOwnership(
        clientTransactionId,
        userId,
      );

      return sendResponse(200, transaction, "Success", null, context);
    } else if (bookingId) {
      // Get the transactions for a booking, optionally on one date
      // runQuery returns { items, lastEvaluatedKey }, not an array
      const { items = [] } = date
        ? await getTransactionsByBookingIdDate(bookingId, date)
        : await getTransactionsByBookingId(bookingId);

      const validTransactions = items.filter(
        (transaction) => transaction.userId === userId,
      );

      return sendResponse(200, validTransactions, "Success", null, context);
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
