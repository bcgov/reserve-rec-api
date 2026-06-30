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
} = require("../methods");

exports.handler = async (event, context) => {
  logger.info("Transactions admin GET:", event);

  try {
    // Only allow superadmins to GET payment info
    const authContext = checkAuthContext(event, "superadmin");

    // Get the user sub from the authorizer context (admin user)
    const adminId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!adminId) {
      throw new Exception(
        "Unauthorized: Authentication required to GET a transaction",
        { code: 401 },
      );
    }

    const params = event?.queryStringParameters || {};
    const bookingId = params.bookingId;
    const date = params.date;
    const clientTransactionId =
      params.clientTransactionId || event?.pathParameters?.clientTransactionId;

    if (clientTransactionId) {
      // Get a specific transaction using transactionId
      return await getTransactionByTransactionId(clientTransactionId);
      
    } else if (bookingId && date && !clientTransactionId) {
      // Get all transaction created for a specific booking on a date
      return await getTransactionsByBookingIdDate(bookingId, date);
      
    } else if (bookingId && !date && !clientTransactionId) {
      // Get all transactions created for a specific booking
      return await getTransactionsByBookingId(bookingId);
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
