// Get transaction

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { getTransactionByTransactionId } = require("../methods");
const { getOneByGlobalId, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");

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
    const sessionId = event?.queryStringParameters?.sessionId || null;

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
          `Forbidden: Invalid credentials`,
          { code: 403 }
        );
      }
      // Email matches, allow access
      return sendResponse(200, transactions, "Success", null, context);
    } else if (sessionId) {
      // SessionId provided - verify sessionId matches transaction sessionId (for guest payment retry)
      if (transactions?.sessionId !== sessionId) {
        throw new Exception(
          `Forbidden: Session does not match transaction`,
          { code: 403 }
        );
      }
      
      // Validate session hasn't expired by checking the associated booking
      try {
        const bookingId = transactions.bookingId;
        if (!bookingId) {
          throw new Exception(`Transaction has no associated booking`, { code: 400 });
        }
        
        const booking = await getOneByGlobalId(bookingId, TRANSACTIONAL_DATA_TABLE_NAME, 'globalId', 'globalId-index');
        
        if (!booking) {
          throw new Exception(`Associated booking not found`, { code: 404 });
        }
        
        // Check if session has expired
        if (booking.sessionExpiry) {
          const expiryTime = new Date(booking.sessionExpiry).getTime();
          const now = Date.now();
          if (now > expiryTime) {
            logger.warn(`Expired session: booking ${bookingId} expired at ${booking.sessionExpiry}`);
            throw new Exception("Session has expired", { code: 410 });
          }
        }
      } catch (error) {
        // If it's already an Exception, re-throw it
        if (error instanceof Exception) {
          throw error;
        }
        // Otherwise wrap it
        throw new Exception(`Error validating session: ${error.message}`, { code: 500 });
      }
      
      // SessionId matches and session is valid, allow access
      return sendResponse(200, transactions, "Success", null, context);
    } else if (userId) {
      if (transactions.userId !== userId) {
        throw new Exception(
          `Forbidden: Access denied`,
          { code: 403 }
        );
      }
      return sendResponse(200, transactions, "Success", null, context);
    } else {
      // No authentication method provided
      throw new Exception(
        `Forbidden: Authentication required`,
        { code: 403 }
      );
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
