const { 
  checkAuthContext, 
  Exception, 
  logger, 
  sendResponse, 
  getRequestClaimsFromEvent, 
  writeAuditLog 
} = require("/opt/base");
const { 
  batchTransactData, 
  TRANSACTIONAL_DATA_TABLE_NAME, 
  AUDIT_TABLE_NAME, 
  marshall, 
  batchWriteData 
} = require("/opt/dynamodb");
const { quickApiPutHandler, quickApiUpdateHandler } = require("../../../../../common/data-utils");
const {
  createRefund,
  createAndCheckRefundHash,
  findAndVerifyTransactionOwnership
} = require("../../../methods");
const { REFUND_PUT_CONFIG, TRANSACTION_UPDATE_CONFIG } = require("../../../configs");

exports.handler = async (event, context) => {
  logger.info("Admin Refund POST:", event);

  try {
    checkAuthContext(event, "superadmin");
    const adminId = getRequestClaimsFromEvent(event)?.sub || null;

    const body = JSON.parse(event?.body || "{}");
    const bookingId = event?.pathParameters?.bookingId
    const clientTransactionId = body?.clientTransactionId;
    const refundAmount = body?.refundAmount;
    const userId = body?.userId;

    if (!bookingId || !clientTransactionId || !userId || !refundAmount) {
      throw new Exception("Cannot issue refund - missing bookingId, clientTransactionId, userId, or refundAmount", {
        code: 400,
        data: { adminId, clientTransactionId }
      });
    }

    // Fetch the transaction
    const transaction = await findAndVerifyTransactionOwnership(clientTransactionId, userId);

    // Check status
    if (transaction.status === "refunded") {
      throw new Exception("Transaction already fully refunded", { code: 409 });
    }

    // Only allow fully paid or partially refunds to continue
    if (!["paid", "partial refund"].includes(transaction.status)) {
      throw new Exception(`Transaction status '${transaction.status}' is not eligible for refund`, { code: 409 });
    }

    // Idempotency to ensure only one refund
    // Returns a refundHashObj with refundHash, refundSequence, totalRefunded, and totalAfterRefund
    const refundHashObj = await createAndCheckRefundHash(
      userId, 
      transaction.clientTransactionId, 
      refundAmount, 
      bookingId
    );

    // Process refund
    const refundPutRequest = await createRefund(transaction, refundAmount, refundHashObj, body);

    // Build refund record
    const putRefundItems = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [refundPutRequest],
      REFUND_PUT_CONFIG
    );

    // Update the original transaction and status
    const isFullRefund = refundHashObj.totalAfterRefund >= (transaction.trnAmount || transaction.amount);
    const newStatus = isFullRefund ? "refunded" : "partial refund";

    const updateOriginalTxItem = await quickApiUpdateHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [
        {
          key: { pk: transaction.pk, sk: transaction.sk },
          data: {
            status: newStatus,
            status: newStatus,
            refundAmounts: {
              value: [
                ...(transaction.refundAmounts || []),
                { [refundPutRequest.data.refundTransactionId]: Number(refundAmount) }
              ],
              action: "set"
            }
          }
        }
      ],
      TRANSACTION_UPDATE_CONFIG
    );

    // Update to database
    const res = await batchTransactData([...putRefundItems, ...updateOriginalTxItem]);

    // Audit Log
    await writeAuditLog(
      adminId,
      clientTransactionId,
      "ADMIN_REFUND_SUCCESS",
      { result: true, amount: refundAmount, refund: refundPutRequest.data },
      marshall,
      batchWriteData,
      AUDIT_TABLE_NAME
    );

    return sendResponse(200, { response: { res, refund: refundPutRequest.data } }, "Refund Success", null, context);

  } catch (error) {
    const adminId = getRequestClaimsFromEvent(event)?.sub || "unknown";
    const clientTransactionId = event?.pathParameters?.clientTransactionId || "unknown";

    await writeAuditLog(
      adminId,
      clientTransactionId,
      "ADMIN_REFUND_FAILURE",
      { success: false, message: error.msg || error.message },
      marshall,
      batchWriteData,
      AUDIT_TABLE_NAME
    );

    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error processing refund",
      error?.error || error,
      context
    );
  }
};
