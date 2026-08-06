// Create new transaction
const {
  checkAuthContext,
  Exception,
  getRequestClaimsFromEvent,
  logger,
  sendResponse,
  writeAuditLog,
} = require("/opt/base");
const { processTokenTransaction } = require("../../methods");
const {
  AUDIT_TABLE_NAME,
  batchWriteData,
  marshall,
} = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("Transactions admin POST:", event);

  try {
    // Only allow superadmins to make payments
    const authContext = checkAuthContext(event, "superadmin");

    // Get relevant data from the event
    const body = JSON.parse(event?.body);
    logger.debug("transaction body: ", body);

    // Get the user sub from the authorizer context (admin user)
    const adminId = getRequestClaimsFromEvent(event)?.sub || null;

    if (!adminId) {
      const message = "Unauthorized: Authentication required to create transaction";
      throw new Exception(
        message, { 
          code: 401,
          message: message,
          data: {
            adminId: "no adminId",
            bookingId: body?.bookingId,
            body: body
          },
        },
      );
    }

    // Ensure the user has passed in a transaction amount, booking
    // Session ID isn't needed for admin
    const requiredFields = ["trnAmount", "bookingId", "token", "userId"];
    for (const field of requiredFields) {
      if (!body?.[field]) {
        const message = `Missing required transaction field '${field}'`;
        throw new Exception(message, {
          code: 400,
          message: message,
          data: {
            adminId: adminId,
            bookingId: body?.bookingId,
            body: body
          },
        });
      }
    }

    let response;
    response = await processTokenTransaction(body, body.userId, adminId);

    await writeAuditLog(
      adminId,
      response?.transaction.clientTransactionId,
      "ADMIN_PAYMENT_SUCCESS",
      {
        result: response.success,
        message: response.message,
        transaction: response?.transaction,
      },
      marshall,
      batchWriteData,
      AUDIT_TABLE_NAME,
    );

    logger.info(`Transaction processed successfully`, response);

    return sendResponse(200, { response }, "Success", null, context);
  } catch (error) {
    await writeAuditLog(
      error?.data?.adminId,
      `BCPR-${error?.data?.body?.bookingId}`,
      "ADMIN_PAYMENT_FAILURE",
      {
        success: false,
        message: error.msg || error.message,
        transaction:  error.data?.transaction || '',
      },
      marshall,
      batchWriteData,
      AUDIT_TABLE_NAME,
    );

    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context,
    );
  }
};
