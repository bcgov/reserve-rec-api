// SQS-triggered Lambda for processing Worldline API requests
// This handler is decoupled from the main refund flow for better reliability and retry logic

const { Exception, logger } = require("/opt/base");
const { TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const axios = require("axios");
const crypto = require('crypto');
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { batchTransactData } = require("/opt/dynamodb");
const { REFUND_UPDATE_CONFIG, TRANSACTION_UPDATE_CONFIG } = require("../../configs");

const HASH_KEY = process.env.HASH_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;
const WORLDLINE_API_URL = process.env.WORLDLINE_API_URL || 'https://web.na.bambora.com/scripts/process_transaction.asp';

/**
 * Process Worldline refund API request
 * Message format from SQS:
 * {
 *   refundTransactionId: string,
 *   originalTransactionId: string,
 *   worldlineTransactionId: string (trnId from original payment),
 *   refundAmount: number,
 *   pendingTransactionStatus: string
 * }
 */
exports.handler = async (event) => {
  logger.info("Worldline Processor received event:", JSON.stringify(event, null, 2));

  const results = [];
  const failures = [];

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      logger.info("Processing Worldline request:", message);

      const { 
        refundTransactionId, 
        originalTransactionId, 
        worldlineTransactionId, 
        refundAmount,
        pendingTransactionStatus 
      } = message;

      // Validate required fields
      if (!refundTransactionId || !worldlineTransactionId || !refundAmount) {
        throw new Exception("Missing required fields in message", { code: 400 });
      }

      // Construct Worldline API request
      const params = new URLSearchParams({
        requestType: "BACKEND",
        merchant_id: MERCHANT_ID,
        trnType: "R",
        adjId: worldlineTransactionId, // Original Worldline transaction ID
        trnAmount: `${refundAmount}`,
        trnOrderNumber: refundTransactionId, // New refund transaction ID
      });

      // Calculate hash
      const paramsString = params.toString();
      const allValues = `${paramsString}${HASH_KEY}`;
      const hashValue = crypto.createHash("md5").update(allValues).digest("hex");
      params.append('hashValue', hashValue);

      logger.info("Worldline POST params:", params.toString());

      // Make the API call to Worldline
      const res = await axios.post(WORLDLINE_API_URL, params.toString());

      logger.debug("Worldline response status:", res?.status);
      logger.debug("Worldline response data:", res?.data);

      // Extract response data (could be in res.data for some APIs)
      const responseData = typeof res.data === 'object' ? res.data : res;
      const { trnApproved, messageId, messageText, trnId } = responseData;

      logger.info(`Worldline response - trnApproved: ${trnApproved}, messageId: ${messageId}, messageText: ${messageText}, trnId: ${trnId}`);
      
      const updateData = {};
      
      // Handle test/dev environments where Worldline may not respond properly
      if (!trnApproved && process.env.IS_OFFLINE) {
        logger.warn("Running in local/test mode with no Worldline response - marking as refunded for testing");
        updateData.transactionStatus = "refunded";
      } else if (trnApproved === '1') {
        updateData.transactionStatus = "refunded";
        logger.info("Refund approved by Worldline");
      } else {
        updateData.transactionStatus = "unknown"; // Use 'unknown' for declined refunds
        logger.warn(`Worldline declined refund: ${messageText} (messageId: ${messageId})`);
        
        // For declined refunds, throw error to retry (might be temporary issue)
        throw new Exception(`Worldline declined refund: ${messageText}`, { 
          code: 400
        });
      }
      
      // Update refund record in DynamoDB following Worldline response
      const refundUpdate = {
        key: {
          pk: `transaction::${originalTransactionId}`,
          sk: `refund::${refundTransactionId}`,
        },
        data: updateData
      };

      const updateItems = await quickApiUpdateHandler(
        TRANSACTIONAL_DATA_TABLE_NAME,
        [refundUpdate],
        REFUND_UPDATE_CONFIG
      );

      await batchTransactData(updateItems);

      // Update original transaction record with updated transaction status
      const updateOriginalTransaction = {
        key: {
          pk: `transaction::${originalTransactionId}`,
          sk: `details`,
        },
        data: {
          transactionStatus: pendingTransactionStatus,
        }
      }

      const updateTransaction = await quickApiUpdateHandler(
        TRANSACTIONAL_DATA_TABLE_NAME,
        [updateOriginalTransaction],
        TRANSACTION_UPDATE_CONFIG
      );

      await batchTransactData(updateTransaction);

      logger.info(`Successfully processed Worldline refund for ${refundTransactionId}`);

      results.push({
        refundTransactionId,
        status: 'success',
        trnApproved,
      });

    } catch (error) {
      logger.error("Error processing Worldline request:", error.message || error);
      
      // Log detailed error info for debugging
      if (error.response) {
        logger.error("Worldline error response status:", error.response?.status);
        logger.error("Worldline error response data:", error.response?.data);
      }

      failures.push({
        messageId: record.messageId,
        error: error.message || String(error),
      });

      // Throw error to trigger SQS retry mechanism
      // SQS will automatically retry based on the queue's redrive policy
      throw error;
    }
  }

  // If we got here, all messages were processed successfully
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Worldline requests processed',
      results,
      failures,
    }),
  };
};
