// SQS-triggered Lambda for processing Worldline API requests
// This handler is decoupled from the main refund flow for better reliability and retry logic

const { Exception, logger } = require("/opt/base");
const { TRANSACTIONAL_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");
const axios = require("axios");
const crypto = require('crypto');
const { quickApiUpdateHandler } = require("../../../src/common/data-utils");
const { REFUND_UPDATE_CONFIG, TRANSACTION_UPDATE_CONFIG } = require("../../../src/handlers/transactions/configs");

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

      if (!refundTransactionId || !worldlineTransactionId || !refundAmount) {
        throw new Exception("Missing required fields in message", { code: 400 });
      }

      const params = new URLSearchParams({
        requestType: "BACKEND",
        merchant_id: MERCHANT_ID,
        trnType: "R",
        adjId: worldlineTransactionId,
        trnAmount: `${refundAmount}`,
        trnOrderNumber: refundTransactionId,
      });

      const paramsString = params.toString();
      const allValues = `${paramsString}${HASH_KEY}`;
      const hashValue = crypto.createHash("md5").update(allValues).digest("hex");
      params.append('hashValue', hashValue);

      logger.info("Worldline POST params:", params.toString());

      const res = await axios.post(WORLDLINE_API_URL, params.toString());

      logger.debug("Worldline response status:", res?.status);
      logger.debug("Worldline response data:", res?.data);

      const responseData = typeof res.data === 'object' ? res.data : res;
      const { trnApproved, messageId, messageText, trnId } = responseData;

      logger.info(`Worldline response - trnApproved: ${trnApproved}, messageId: ${messageId}, messageText: ${messageText}, trnId: ${trnId}`);
      
      const updateData = {};
      
      if (!trnApproved && process.env.IS_OFFLINE) {
        logger.warn("Running in local/test mode with no Worldline response - marking as refunded for testing");
        updateData.transactionStatus = "refunded";
      } else if (trnApproved === '1') {
        updateData.transactionStatus = "refunded";
        logger.info("Refund approved by Worldline");
      } else {
        updateData.transactionStatus = "unknown";
        logger.warn(`Worldline declined refund: ${messageText} (messageId: ${messageId})`);
        
        throw new Exception(`Worldline declined refund: ${messageText}`, { 
          code: 400
        });
      }
      
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
      
      if (error.response) {
        logger.error("Worldline error response status:", error.response?.status);
        logger.error("Worldline error response data:", error.response?.data);
      }
      
      failures.push({
        refundTransactionId: JSON.parse(record.body)?.refundTransactionId || 'unknown',
        error: error.message || String(error),
      });
    }
  }

  if (failures.length > 0) {
    logger.error(`${failures.length} Worldline request(s) failed`, failures);
    throw new Error(`Failed to process ${failures.length} Worldline request(s)`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Worldline requests processed',
      results,
    }),
  };
};
