// SNS Subscriber for Refund Requests
// This handler is triggered by SNS messages for refund processing
const { Exception, logger } = require("/opt/base");
const { batchTransactData, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { quickApiPutHandler, quickApiUpdateHandler } = require("../../../../common/data-utils");
const {
  createRefund,
  createAndCheckRefundHash,
  findAndVerifyTransactionOwnership,
  updateTransactionForRefund,
} = require("../../methods");
const { REFUND_PUT_CONFIG, TRANSACTION_UPDATE_CONFIG, REFUND_UPDATE_CONFIG } = require("../../configs");

const WORLDLINE_QUEUE_URL = process.env.WORLDLINE_REQUEST_QUEUE_URL;

const sqsClient = new SQSClient({ 
  region: process.env.AWS_REGION || 'ca-central-1',
  endpoint: process.env.SQS_ENDPOINT_URL || process.env.SNS_ENDPOINT_URL,
  credentials: process.env.IS_OFFLINE ? {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy'
  } : undefined
});

exports.handler = async (event, context) => {
  logger.info("Refund Subscriber:", event);

  try {
    // Parse SNS message(s)
    const records = event.Records || [];
    const results = [];

    for (const record of records) {
      if (record.EventSource !== 'aws:sns') {
        logger.warn('Skipping non-SNS record:', record);
        continue;
      }

      const message = JSON.parse(record.Sns.Message);
      const { clientTransactionId, bookingId, userId, refundAmount, reason } = message;

      logger.info(
        `Processing refund for transaction: ${clientTransactionId}, amount: ${refundAmount}`
      );

      // Verify ownership before proceeding
      const transaction = await findAndVerifyTransactionOwnership(
        clientTransactionId,
        userId
      );

      // Additional refund validations
      if (transaction.transactionStatus === "refunded") {
        logger.warn(`Transaction ${clientTransactionId} already fully refunded`);
        results.push({ clientTransactionId, transactionStatus: 'already_refunded' });
        continue;
      }

      // Only allow refunds for paid or partially refunded transactions
      if (
        transaction.transactionStatus !== "paid" &&
        transaction.transactionStatus !== "partial refund"
      ) {
        logger.warn(`Transaction ${clientTransactionId} not eligible for refund. Status: ${transaction.status}`);
        results.push({ 
          clientTransactionId, 
          transactionStatus: 'not_eligible',
          currentStatus: transaction.transactionStatus 
        });
        continue;
      }

      // Creates a hash for idempotency and validates refund
      logger.info("Checking refund idempotency and validating refund amount");
      let refundMetadata;
      try {
        // This returns: { refundHash, refundSequence, totalRefunded, totalAfterRefund }
        refundMetadata = await createAndCheckRefundHash(
          userId,
          transaction.clientTransactionId,
          refundAmount
        );
        
        logger.info(`Refund metadata: sequence=${refundMetadata.refundSequence}, totalBefore=$${refundMetadata.totalRefunded}, totalAfter=$${refundMetadata.totalAfterRefund}`);
        
        // Validate refund amount does not exceed original transaction amount
        if (refundMetadata.totalAfterRefund > transaction.amount) {
          logger.warn(`Total refund amount $${refundMetadata.totalAfterRefund} exceeds transaction amount $${transaction.amount}`);
          throw new Exception(
            `Total refund amount ($${refundMetadata.totalAfterRefund}) would exceed transaction amount ($${transaction.amount})`,
            { code: 400 }
          );
        }
      } catch (error) {
        // If duplicate detected, treat as already processed
        if (error.code === 409) {
          logger.warn(`Duplicate refund request for transaction ${clientTransactionId}, treating as already processed`);
          results.push({ 
            clientTransactionId, 
            transactionStatus: 'already_processed',
            refundAmount: refundAmount
          });
          continue;
        }
        throw error;
      }

      // Initiate the refund process
      logger.info(
        `Initiating refund ${refundMetadata.refundSequence} of amount ${refundAmount} for transaction ${clientTransactionId}`
      );

      // Create refund record in DynamoDB
      const refundData = await createRefund(
        transaction, 
        refundAmount, 
        refundMetadata.refundHash, 
        { reason, refundSequence: refundMetadata.refundSequence }
      );

      const putItems = await quickApiPutHandler(
        TRANSACTIONAL_DATA_TABLE_NAME,
        [refundData],
        REFUND_PUT_CONFIG
      );

      await batchTransactData(putItems);

      // Update the original transaction to reflect the refund
      logger.info("Transaction before update:", JSON.stringify({
        pk: transaction.pk,
        sk: transaction.sk,
        refundAmounts: transaction.refundAmounts
      }, null, 2));
      
      const updateOriginalTransaction = await updateTransactionForRefund(
        transaction,
        refundAmount,
        refundData.data.refundTransactionId,
        refundMetadata.totalAfterRefund,
      );

      const updateItems = await quickApiUpdateHandler(
        TRANSACTIONAL_DATA_TABLE_NAME,
        [updateOriginalTransaction],
        TRANSACTION_UPDATE_CONFIG
      );

      await batchTransactData(updateItems);

      logger.info(`Refund record created successfully for transaction ${clientTransactionId}`);

      // Queue the Worldline API request to SQS for async processing
      try {
        const updatedTransactionStatus = refundMetadata.totalAfterRefund === transaction.amount ? "refunded" : "partial refund";

        const sqsMessage = {
          refundTransactionId: refundData.data.refundTransactionId,
          originalTransactionId: transaction.clientTransactionId,
          worldlineTransactionId: transaction.trnId, // Original Worldline transaction ID
          refundAmount: refundAmount,
          pendingTransactionStatus: updatedTransactionStatus,
        };

        const sendMessageCommand = new SendMessageCommand({
          QueueUrl: WORLDLINE_QUEUE_URL,
          MessageBody: JSON.stringify(sqsMessage),
          MessageAttributes: {
            refundTransactionId: {
              DataType: 'String',
              StringValue: refundData.data.refundTransactionId,
            },
          },
        });

        const sqsResult = await sqsClient.send(sendMessageCommand);
        logger.info(`Queued Worldline request to SQS, MessageId: ${sqsResult.MessageId}`);
      } catch (sqsError) {
        logger.error("Failed to queue Worldline request:", sqsError);
    
        // Mark refund as 'failed to queue' in DynamoDB
        const failedTransactionAttempt = {
          key: {
            pk: refundData.data.pk,
            sk: refundData.data.sk,
          },
          data: {
            transactionStatus: 'failed',
          }
        };

        const updateItems = await quickApiUpdateHandler(
          TRANSACTIONAL_DATA_TABLE_NAME,
          [failedTransactionAttempt],
          REFUND_UPDATE_CONFIG
        );

        await batchTransactData(updateItems);
        
        // Throw error to trigger SNS retry
        throw new Exception(
          `Failed to queue Worldline request: ${sqsError.message}`,
          { code: 500, originalError: sqsError }
        );
      }

      results.push({ 
        clientTransactionId, 
        transactionStatus: 'queued_for_processing',
        refundAmount: refundAmount,
        refundId: refundData.data.refundTransactionId,
        refundSequence: refundMetadata.refundSequence,
        totalRefunded: refundMetadata.totalAfterRefund
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Refunds processed',
        results,
      }),
    };
  } catch (error) {
    logger.error("Error processing refund:", error);
    return {
      statusCode: Number(error?.code) || 500,
      body: JSON.stringify({
        message: error?.message || "Error processing refund",
        error: error?.error || error,
      }),
    };
  }
};
