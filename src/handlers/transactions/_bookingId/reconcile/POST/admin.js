// Settle a booking's stuck payment from Worldline's record, or by the admin's ruling when the body has a status
const {
  requestIdentity,
  checkAuthContext,
  Exception,
  getRequestClaimsFromEvent,
  logger,
  sendResponse,
  writeAuditLog,
} = require("/opt/base");
const { reconcilePayment, settlePaymentManually } = require("../../../payment-attempts");
const {
  AUDIT_TABLE_NAME,
  batchWriteData,
  marshall,
} = require("/opt/dynamodb");

function parseBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body) || {};
  } catch {
    throw new Exception("Request body is not valid JSON", { code: 400 });
  }
}

exports.handler = async (event, context) => {
  logger.info("Transactions admin reconcile POST:", requestIdentity(event));

  let adminId = null;
  const bookingId = event?.pathParameters?.bookingId;
  try {
    checkAuthContext(event, "superadmin");
    adminId = getRequestClaimsFromEvent(event)?.sub || null;
    if (!adminId) {
      throw new Exception("Unauthorized: Authentication required to reconcile a payment", { code: 401 });
    }
    if (!bookingId) {
      throw new Exception("Missing bookingId", { code: 400 });
    }
    const { status, reason } = parseBody(event);
    const manual = status !== undefined;

    const { lock, attempt } = manual
      ? await settlePaymentManually(bookingId, { status, reason, adminId })
      : await reconcilePayment(bookingId);
    if (!lock) {
      logger.info("event=payment_reconcile_not_found", { bookingId, adminId });
      throw new Exception("This booking has no payment to reconcile", { code: 404, data: { bookingId } });
    }
    logger.info("event=payment_reconcile_requested", { bookingId, adminId, status: lock.status, manual });

    await writeAuditLog(
      adminId,
      lock.activeClientTransactionId,
      manual ? "ADMIN_PAYMENT_SETTLE" : "ADMIN_PAYMENT_RECONCILE",
      { bookingId, status: lock.status, needsReconciliation: lock.needsReconciliation, ...(manual && { reason }) },
      marshall,
      batchWriteData,
      AUDIT_TABLE_NAME,
    );

    return sendResponse(200, { lock, attempt }, "Success", null, context);
  } catch (error) {
    if (adminId) {
      await writeAuditLog(
        adminId,
        `BCPR-${bookingId}`,
        "ADMIN_PAYMENT_RECONCILE_FAILURE",
        { success: false, message: error.msg || error.message },
        marshall,
        batchWriteData,
        AUDIT_TABLE_NAME,
      );
    }
    return sendResponse(
      Number(error?.code) || 500,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context,
    );
  }
};
