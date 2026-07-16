// Create new transaction
const {
  Exception,
  getRequestClaimsFromEvent,
  logger,
  sendResponse,
} = require("/opt/base");
const { processTokenTransaction } = require("../methods");

exports.handler = async (event, context) => {
  logger.info("Transactions public POST:", event);

  try {
    // Get relevant data from the event
    const body = JSON.parse(event?.body);
    logger.debug("transaction body: ", body);

    const claims = getRequestClaimsFromEvent(event);
    let userId = claims?.sub || null;

    // Ensure the request is fully authenticated (not a guest)
    const isAuthenticated = event.requestContext?.authorizer?.isAuthenticated === 'true' || 
                            event.requestContext?.authorizer?.isAuthenticated === true;

    if (!userId || !isAuthenticated) {
      const message = "Unauthorized: Authentication required to create transaction";
      throw new Exception(message, { code: 401, message: message });
    }

    // Ensure the user has passed in a transaction amount, booking
    // Session ID isn't needed for admin
    const requiredFields = ["trnAmount", "bookingId", "token", "userId", "sessionId"];
    for (const field of requiredFields) {
      if (!body?.[field]) {
        const message = `Missing required transaction field '${field}'`;
        throw new Exception(message, { code: 400, message: message });
      }
    }

    // Prevent user from using other user IDs
    if (body.userId !== userId) {
      const message = "Forbidden: You cannot submit transactions on behalf of another user";
      throw new Exception(message, { code: 403, message: message });
    }

    let response;
    response = await processTokenTransaction(body, userId);

    logger.info(`Transaction processed successfully`, response);

    return sendResponse(200, { response }, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context,
    );
  }
};
