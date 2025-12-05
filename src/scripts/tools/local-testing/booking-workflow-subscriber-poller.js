#!/usr/bin/env node

/**
 * Local SNS Subscriber Poller
 * 
 * This script polls SQS queues (managed by GoAWS) and invokes the subscriber
 * Lambda handlers locally, emulating how SNS → SQS → Lambda works in AWS.
 * 
 * Usage: node sns-subscriber-poller.js
 */

const path = require('path');
const Module = require('module');

// Set up module path aliasing to resolve /opt/* imports (Lambda layers)
// This allows the subscriber handlers to load their dependencies
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain) {
  // Map /opt/<layer> to the actual layer location
  if (request.startsWith('/opt/')) {
    const layerName = request.replace('/opt/', '');
    
    // Map layer names to their actual file locations
    const layerMap = {
      'base': 'base/base.js',
      'dynamodb': 'awsUtils/dynamodb.js',
      'sns': 'awsUtils/sns.js',
      'data-utils': 'dataUtils/data-utils.js',
      'data-constants': 'dataUtils/data-constants.js',
      'validation-rules': 'dataUtils/validation-rules.js',
      'jwt': 'jwt/jwt.js',
      'permissions': 'base/permissions.js',
      'geo': 'base/geo.js',
      'opensearch': 'awsUtils/opensearch.js',
      'cognito': 'awsUtils/cognito.js',
      'ssm': 'awsUtils/ssm.js',
      'secretsManager': 'awsUtils/secretsManager.js',
    };
    
    const layerFile = layerMap[layerName];
    if (layerFile) {
      const layerPath = path.resolve(__dirname, '../../../layers', layerFile);
      return originalResolveFilename.call(this, layerPath, parent, isMain);
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain);
};

// Load environment variables from env.json
const envConfig = require('../../../../env.json');
Object.keys(envConfig.Parameters).forEach(key => {
  let value = envConfig.Parameters[key];
  
  // Replace host.docker.internal with localhost since we're running on the host
  if (typeof value === 'string' && value.includes('host.docker.internal')) {
    value = value.replace('host.docker.internal', 'localhost');
  }
  
  process.env[key] = value;
});

console.log('Environment configured:');
console.log('  DYNAMODB_ENDPOINT_URL:', process.env.DYNAMODB_ENDPOINT_URL);
console.log('  SNS_ENDPOINT_URL:', process.env.SNS_ENDPOINT_URL);
console.log('');

const { 
  SQSClient, 
  ReceiveMessageCommand, 
  DeleteMessageCommand 
} = require("@aws-sdk/client-sqs");

// Configure SQS client for GoAWS
const sqsClient = new SQSClient({
  region: 'ca-central-1',
  endpoint: 'http://localhost:4100',
  credentials: {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy'
  }
});

// Import your subscriber handlers (now that /opt/* is resolved)
const bookingCancellationSubscriber = require('../../../../lib/handlers/bookingCancellationSubscriber');
const refundSubscriber = require('../../../../lib/handlers/refundSubscriber');
const worldlineProcessor = require('../../../../lib/handlers/worldlineProcessor');

// Queue configurations
const QUEUES = [
  {
    name: 'booking-cancellation-queue',
    url: 'http://localhost:4100/queue/booking-cancellation-queue',
    handler: bookingCancellationSubscriber.handler,
    handlerName: 'BookingCancellationSubscriber',
    type: 'sns' // SNS→SQS subscription (message wrapped in SNS format)
  },
  {
    name: 'refund-request-queue',
    url: 'http://localhost:4100/queue/refund-request-queue',
    handler: refundSubscriber.handler,
    handlerName: 'RefundSubscriber',
    type: 'sns' // SNS→SQS subscription (message wrapped in SNS format)
  },
  {
    name: 'worldline-request-queue',
    url: 'http://localhost:4100/queue/worldline-request-queue',
    handler: worldlineProcessor.handler,
    handlerName: 'WorldlineProcessor',
    type: 'sqs' // Direct SQS messages (not from SNS)
  }
];

// Polling configuration
const POLL_INTERVAL_MS = 2000;
const MAX_MESSAGES = 10;
const WAIT_TIME_SECONDS = 20;

/**
 * Poll a single queue and process messages
 */
async function pollQueue(queueConfig) {
  const { url, handler, handlerName, name, type } = queueConfig;
  
  try {
    // Receive messages from queue (long polling)
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: WAIT_TIME_SECONDS,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All']
    });

    const response = await sqsClient.send(receiveCommand);
    
    if (!response.Messages || response.Messages.length === 0) {
      return; // No messages
    }

    console.log(`\n[${new Date().toISOString()}] Received ${response.Messages.length} message(s) from ${name}`);

    // Process each message
    for (const message of response.Messages) {
      try {
        console.log(`\n--- Processing message from ${name} ---`);
        console.log('Message ID:', message.MessageId);
        console.log('Receipt Handle:', message.ReceiptHandle?.substring(0, 20) + '...');
        
        let event;
        
        if (type === 'sqs') {
          // Direct SQS message - create SQS Lambda event format
          event = {
            Records: [
              {
                messageId: message.MessageId,
                receiptHandle: message.ReceiptHandle,
                body: message.Body, // Direct message body
                attributes: message.Attributes || {},
                messageAttributes: message.MessageAttributes || {},
                md5OfBody: message.MD5OfBody,
                eventSource: 'aws:sqs',
                eventSourceARN: `arn:aws:sqs:ca-central-1:123456789012:${name}`,
                awsRegion: 'ca-central-1'
              }
            ]
          };
        } else {
          // SNS→SQS subscription - parse SNS wrapper and create SNS Lambda event format
          const snsMessage = JSON.parse(message.Body);
          
          event = {
            Records: [
              {
                EventSource: 'aws:sns',
                EventVersion: '1.0',
                EventSubscriptionArn: `arn:aws:sns:local:123456789012:${name}:subscription-id`,
                Sns: {
                  Type: 'Notification',
                  MessageId: message.MessageId,
                  TopicArn: snsMessage.TopicArn || `arn:aws:sns::queue:${name}`,
                  Subject: snsMessage.Subject || 'Test Subject',
                  Message: snsMessage.Message,
                  Timestamp: new Date().toISOString(),
                  MessageAttributes: message.MessageAttributes || {}
                }
              }
            ]
          };
        }

        console.log('\nInvoking handler:', handlerName);
        console.log('Event payload:', JSON.stringify(event, null, 2));

        // Invoke the Lambda handler
        const context = {
          functionName: handlerName,
          awsRequestId: `local-${Date.now()}`,
          invokedFunctionArn: `arn:aws:lambda:local:123456789012:function:${handlerName}`,
        };

        const result = await handler(event, context);
        
        console.log('\nHandler result:', JSON.stringify(result, null, 2));

        // Delete message from queue if successfully processed
        if (result.statusCode === 200) {
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: url,
            ReceiptHandle: message.ReceiptHandle
          });
          
          await sqsClient.send(deleteCommand);
          console.log(`✓ Message processed successfully and deleted from ${name}`);
        } else {
          console.log(`✗ Handler returned error status: ${result.statusCode}`);
          console.log('Message will remain in queue for retry');
        }

      } catch (error) {
        console.error(`✗ Error processing message from ${name}:`, error);
        console.error('Stack:', error.stack);
        // Message will remain in queue for retry
      }
    }

  } catch (error) {
    console.error(`Error polling ${name}:`, error.message);
  }
}

/**
 * Start polling all queues
 */
async function startPolling() {
  console.log('='.repeat(60));
  console.log('SNS Subscriber Poller Started');
  console.log('='.repeat(60));
  console.log('\nMonitoring queues:');
  QUEUES.forEach(q => console.log(`  - ${q.name} → ${q.handlerName}`));
  console.log(`\nPolling interval: ${POLL_INTERVAL_MS}ms`);
  console.log('Press Ctrl+C to stop\n');
  console.log('='.repeat(60));

  // Poll all queues concurrently
  const pollAll = async () => {
    await Promise.all(
      QUEUES.map(queueConfig => pollQueue(queueConfig))
    );
  };

  // Initial poll
  await pollAll();

  // Set up interval for subsequent polls
  setInterval(pollAll, POLL_INTERVAL_MS);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down poller...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down poller...');
  process.exit(0);
});

// Start the poller
startPolling().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
