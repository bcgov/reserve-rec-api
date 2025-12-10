// Get transaction

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { getTransactionByTransactionId } = require("../methods");

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
    const email = event?.queryStringParameters?.email || null;

    if (!clientTransactionId) {
      throw new Exception("Required items are missing", { code: 400 });
    }

    // Get userId from claims (may be null for anonymous users)
    const userId = getRequestClaimsFromEvent(event)?.sub || null;
    
    const transactions = await getTransactionByTransactionId(
      clientTransactionId
    );

    // Transaction not found
    if (!transactions) {
      throw new Exception(
        `Transaction ${clientTransactionId} not found`,
        { code: 404 }
      );
    }

    // Email provided - verify email matches transaction email (for guest/unauthenticated lookup)
    if (email) {
      // We capture the user's email in ref3 field, instead of comparing to trnEmailAddress
      if (transactions?.ref3 !== email) {
        throw new Exception(
          `Forbidden: Email ${email} does not match transaction ${clientTransactionId}`,
          { code: 403 }
        );
      }
      // Email matches, allow access
      return sendResponse(200, transactions, "Success", null, context);
    } else if (userId) {
      if (transactions.userId !== userId) {
        throw new Exception(
          `Forbidden: User ${userId} does not have access to transaction ${clientTransactionId}`,
          { code: 403 }
        );
      }
      return sendResponse(200, transactions, "Success", null, context);
    }

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
