// Get transaction

const { Exception, logger, sendResponse } = require("/opt/base");
const { getTransactionByTransactionId } = require("/opt/transactions/methods");

exports.handler = async (event, context) => {
  logger.info("Transactions GET:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Get relevant data from the event
    // Search by ID
    const clientTransactionId =
      event?.pathParameters?.clientTransactionId ||
      event?.queryStringParameters?.clientTransactionId;

    if (!clientTransactionId) {
      throw new Exception("Required items are missing", { code: 400 });
    }

    const transactions = await getTransactionByTransactionId(
      clientTransactionId
    );

    return sendResponse(200, transactions, "Success", null, context);
  } catch (error) {
    logger.error("Error in transactions GET:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.msg || "Error",
      error?.error || error,
      context
    );
  }
};
