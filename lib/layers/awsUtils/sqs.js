/**
 * AWS SQS utilities for queue operations
 */

const { SQSClient, SendMessageCommand, SendMessageBatchCommand, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { logger } = require('/opt/base');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const sqsClient = new SQSClient({ region: AWS_REGION });

/**
 * Send a message to SQS queue
 * @param {Object} params - Message parameters
 * @returns {Promise<Object>} SQS response
 */
async function sendMessage(params) {
  const {
    queueUrl,
    messageBody,
    messageAttributes = {},
    delaySeconds = 0,
    messageGroupId,
    messageDeduplicationId
  } = params;

  const messageParams = {
    QueueUrl: queueUrl,
    MessageBody: typeof messageBody === 'string' ? messageBody : JSON.stringify(messageBody),
    ...(Object.keys(messageAttributes).length > 0 && { MessageAttributes: messageAttributes }),
    ...(delaySeconds > 0 && { DelaySeconds: delaySeconds }),
    ...(messageGroupId && { MessageGroupId: messageGroupId }),
    ...(messageDeduplicationId && { MessageDeduplicationId: messageDeduplicationId })
  };

  try {
    const command = new SendMessageCommand(messageParams);
    const result = await sqsClient.send(command);
    
    logger.info('Message sent to SQS', {
      messageId: result.MessageId,
      queueUrl
    });

    return result;
  } catch (error) {
    logger.error('Failed to send message to SQS', {
      error: error.message,
      queueUrl
    });
    throw error;
  }
}

/**
 * Send multiple messages to SQS queue (batch operation)
 * @param {Object} params - Batch parameters
 * @returns {Promise<Object>} SQS response
 */
async function sendMessageBatch(params) {
  const { queueUrl, entries } = params;

  const batchParams = {
    QueueUrl: queueUrl,
    Entries: entries.map((entry, index) => ({
      Id: entry.id || index.toString(),
      MessageBody: typeof entry.messageBody === 'string' ? entry.messageBody : JSON.stringify(entry.messageBody),
      ...(entry.messageAttributes && { MessageAttributes: entry.messageAttributes }),
      ...(entry.delaySeconds && { DelaySeconds: entry.delaySeconds }),
      ...(entry.messageGroupId && { MessageGroupId: entry.messageGroupId }),
      ...(entry.messageDeduplicationId && { MessageDeduplicationId: entry.messageDeduplicationId })
    }))
  };

  try {
    const command = new SendMessageBatchCommand(batchParams);
    const result = await sqsClient.send(command);
    
    logger.info('Batch messages sent to SQS', {
      successful: result.Successful?.length || 0,
      failed: result.Failed?.length || 0,
      queueUrl
    });

    return result;
  } catch (error) {
    logger.error('Failed to send batch messages to SQS', {
      error: error.message,
      queueUrl
    });
    throw error;
  }
}

/**
 * Receive messages from SQS queue
 * @param {Object} params - Receive parameters
 * @returns {Promise<Object>} SQS response with messages
 */
async function receiveMessages(params) {
  const {
    queueUrl,
    maxNumberOfMessages = 1,
    waitTimeSeconds = 0,
    visibilityTimeoutSeconds,
    messageAttributeNames = ['All']
  } = params;

  const receiveParams = {
    QueueUrl: queueUrl,
    MaxNumberOfMessages: maxNumberOfMessages,
    WaitTimeSeconds: waitTimeSeconds,
    MessageAttributeNames: messageAttributeNames,
    ...(visibilityTimeoutSeconds && { VisibilityTimeout: visibilityTimeoutSeconds })
  };

  try {
    const command = new ReceiveMessageCommand(receiveParams);
    const result = await sqsClient.send(command);
    
    logger.info('Messages received from SQS', {
      messageCount: result.Messages?.length || 0,
      queueUrl
    });

    return result;
  } catch (error) {
    logger.error('Failed to receive messages from SQS', {
      error: error.message,
      queueUrl
    });
    throw error;
  }
}

/**
 * Delete a message from SQS queue
 * @param {Object} params - Delete parameters
 * @returns {Promise<Object>} SQS response
 */
async function deleteMessage(params) {
  const { queueUrl, receiptHandle } = params;

  const deleteParams = {
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle
  };

  try {
    const command = new DeleteMessageCommand(deleteParams);
    const result = await sqsClient.send(command);
    
    logger.info('Message deleted from SQS', {
      queueUrl
    });

    return result;
  } catch (error) {
    logger.error('Failed to delete message from SQS', {
      error: error.message,
      queueUrl
    });
    throw error;
  }
}

/**
 * Create SQS message attributes
 * @param {Object} attributes - Key-value pairs to convert to SQS message attributes
 * @returns {Object} Formatted SQS message attributes
 */
function createMessageAttributes(attributes = {}) {
  const messageAttributes = {};
  
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      if (typeof value === 'string') {
        messageAttributes[key] = {
          DataType: 'String',
          StringValue: value
        };
      } else if (typeof value === 'number') {
        messageAttributes[key] = {
          DataType: 'Number',
          StringValue: value.toString()
        };
      } else if (Buffer.isBuffer(value)) {
        messageAttributes[key] = {
          DataType: 'Binary',
          BinaryValue: value
        };
      }
    }
  });

  return messageAttributes;
}

module.exports = {
  sendMessage,
  sendMessageBatch,
  receiveMessages,
  deleteMessage,
  createMessageAttributes
};