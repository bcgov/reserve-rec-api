const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { batchTransactData, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { quickApiPutHandler } = require("../../../../common/data-utils");
const {
  createRefund,
  createAndCheckRefundHash,
  findAndVerifyTransactionOwnership
} = require("../../methods");
const { REFUND_PUT_CONFIG } = require("../../configs");

exports.handler = async (event, context) => {
  logger.info("Refund POST:", event);

  try {
    // Get transactionId from path parameters - this is the new pattern /transactions/{transactionId}/refunds
    const transactionId = event?.pathParameters?.transactionId;
    const userId = getRequestClaimsFromEvent(event)?.sub || null;

    const body = JSON.parse(event?.body);
    const trnAmount = body?.trnAmount;

    // Validate required parameters
    const missingParams = [];
    if (!userId) missingParams.push("userId");
    if (!transactionId) missingParams.push("transactionId");
    if (!body) missingParams.push("body");
    if (!trnAmount) missingParams.push("trnAmount");

    // 401 if userId is missing, 400 for others
    if (missingParams.length > 0) {
      const code = !userId ? 401 : 400;
      throw new Exception(
        `Cannot issue refund - missing required parameter(s): ${missingParams.join(", ")}`,
        { code }
      );
    }

    // Verify ownership before proceeding
    const transaction = await findAndVerifyTransactionOwnership(
      transactionId,
      userId
    );

    // Additional refund validations
    if (transaction.transactionStatus === "refunded") {
      throw new Exception("Transaction already fully refunded", { code: 409 });
    }

    // Only allow refunds for paid or partially refunded transactions
    if (
      transaction.transactionStatus !== "paid" &&
      transaction.transactionStatus !== "partial refund"
    ) {
      throw new Exception("Transaction not eligible for refund", { code: 409 });
    }

    // Creates a hash of the userId, clientTransactionId, and trnAmount to check for idempotency
    // Should collide with any previous refund attempts with the same parameters
    logger.info("Checking refund idempotency");
    const refundHash = await createAndCheckRefundHash(
      userId,
      transaction.clientTransactionId,
      trnAmount
    );

    // Initiate the refund process
    logger.info(
      `Initiating refund of amount ${trnAmount} for transaction ${transaction}`
    );
    const postRequests = await createRefund(transaction, trnAmount, refundHash, body);

    const putItems = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [postRequests],
      REFUND_PUT_CONFIG
    );

    const res = await batchTransactData(putItems);

    const response = {
      res: res,
      transaction: postRequests,
    };

    logger.info(`Refund created successfully`, response);

    return sendResponse(200, { response }, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error processing refund",
      error?.error || error,
      context
    );
  }
};
