const { BaseStack } = require('../helpers/base-stack');
const { Duration } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const { LambdaSubscription, SqsSubscription } = require('aws-cdk-lib/aws-sns-subscriptions');
const { logger } = require("../helpers/utils");
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { Queue } = require('aws-cdk-lib/aws-sqs');
const { SqsEventSource } = require('aws-cdk-lib/aws-lambda-event-sources');
const { StackPrimer } = require("../helpers/stack-primer");
const { Topic } = require('aws-cdk-lib/aws-sns');

const defaults = {
  constructs: {
    bookingNotificationTopic: {
      name: 'BookingNotificationTopic',
    },
    refundRequestTopic: {
      name: 'RefundRequestTopic',
    },
  },
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
    // Topic configuration
    bookingNotificationTopicName: 'reserve-rec-booking-notifications',
    refundRequestTopicName: 'reserve-rec-refund-requests',
    // Subscription configuration
    enableEmailSubscriptions: false,
    // Topic retention and policies
    topicRemovalPolicy: 'retain',
    enableTopicEncryption: true,
    // Refund workflow configuration
    enableRefundWorkflow: true,
  }
};

class BookingWorkflowStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Booking Workflow Stack: ${this.stackId}`);

    // Resolve dependencies from other stacks
    const kmsKey = this.getConfigValue('enableTopicEncryption') ? scope.resolveKmsKey(this) : undefined;
    const transactionalDataTableName = scope.resolveTransDataTableName(this);
    const transDataTableArn = scope.resolveTransDataTableArn(this);
    
    // Resolve layers
    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);

    // Create SNS Topics

    // Booking-specific notification topic
    this.bookingNotificationTopic = new Topic(this, this.getConstructId('bookingNotificationTopic'), {
      topicName: this.getConfigValue('bookingNotificationTopicName'),
      displayName: `${this.getAppName()} - ${this.getDeploymentName()} - Booking Notifications`,
      masterKey: kmsKey,
    });

    // Refund Request Topic - Fan-out pattern for coordinated refunds
    this.refundRequestTopic = new Topic(this, this.getConstructId('refundRequestTopic'), {
      topicName: this.getConfigValue('refundRequestTopicName'),
      displayName: `${this.getAppName()} - ${this.getDeploymentName()} - Refund Requests`,
      masterKey: kmsKey,
    });

    // Create Dead Letter Queue for failed Worldline requests
    this.worldlineDeadLetterQueue = new Queue(this, 'WorldlineDeadLetterQueue', {
      queueName: `${this.getConfigValue('refundRequestTopicName')}-worldline-dlq`,
      retentionPeriod: Duration.days(14),
      // Add CloudWatch alarm for DLQ messages
      messageRetentionPeriod: Duration.days(14),
    });

    // Create SQS Queue for Worldline API requests
    this.worldlineRequestQueue = new Queue(this, 'WorldlineRequestQueue', {
      queueName: `${this.getConfigValue('refundRequestTopicName')}-worldline-requests`,
      visibilityTimeout: Duration.seconds(90),
      receiveMessageWaitTimeSeconds: 20,
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: this.worldlineDeadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Create Lambda subscribers

    // Booking Cancellation Subscriber Lambda
    this.bookingCancellationSubscriber = new NodejsFunction(this, 'BookingCancellationSubscriber', {
      code: lambda.Code.fromAsset('src/handlers/bookings/cancel/subscriber'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        REFUND_REQUEST_TOPIC_ARN: this.refundRequestTopic.topicArn,
      },
      layers: [baseLayer, awsUtilsLayer],
    });

    // Refund Subscriber Lambda
    this.refundSubscriber = new NodejsFunction(this, 'RefundSubscriber', {
      code: lambda.Code.fromAsset('src/handlers/transactions/refunds/subscriber'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        WORLDLINE_REQUEST_QUEUE_URL: this.worldlineRequestQueue.queueUrl, // Add queue URL
      },
      layers: [baseLayer, awsUtilsLayer],
    });

    // Update Lambda timeout to match
    this.worldlineProcessor = new NodejsFunction(this, 'WorldlineProcessor', {
      code: lambda.Code.fromAsset('src/handlers/transactions/refunds/processor'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        MERCHANT_ID: process.env.MERCHANT_ID || '',
        HASH_KEY: process.env.HASH_KEY || '',
      },
      layers: [baseLayer, awsUtilsLayer],
      reservedConcurrentExecutions: 5,
    });

    // Connect SQS queue to Worldline processor Lambda
    this.worldlineProcessor.addEventSource(new SqsEventSource(this.worldlineRequestQueue, {
      batchSize: 1, // Process one refund at a time for better error handling
      maxBatchingWindow: Duration.seconds(0), // Process immediately
    }));

    // Grant permissions to subscribers

    // DynamoDB permissions for booking cancellation subscriber
    const cancellationDynamoPolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
      ],
      resources: [transDataTableArn, `${transDataTableArn}/index/*`],
    });
    this.bookingCancellationSubscriber.addToRolePolicy(cancellationDynamoPolicy);

    // SNS publish permission for cascading refund request
    const snsPublishPolicy = new iam.PolicyStatement({
      actions: ['sns:Publish'],
      resources: [this.refundRequestTopic.topicArn],
    });
    this.bookingCancellationSubscriber.addToRolePolicy(snsPublishPolicy);

    // DynamoDB permissions for refund subscriber
    const refundDynamoPolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
      ],
      resources: [transDataTableArn, `${transDataTableArn}/index/*`],
    });
    this.refundSubscriber.addToRolePolicy(refundDynamoPolicy);

    // SQS send permission for refund subscriber to queue Worldline requests
    const sqsSendPolicy = new iam.PolicyStatement({
      actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
      resources: [this.worldlineRequestQueue.queueArn],
    });
    this.refundSubscriber.addToRolePolicy(sqsSendPolicy);

    // DynamoDB permissions for Worldline processor
    const worldlineDynamoPolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: [transDataTableArn, `${transDataTableArn}/index/*`],
    });
    this.worldlineProcessor.addToRolePolicy(worldlineDynamoPolicy);

    // Subscribe Lambda functions to SNS topics
    this.bookingNotificationTopic.addSubscription(
      new LambdaSubscription(this.bookingCancellationSubscriber, {
        filterPolicy: {
          eventType: {
            conditions: ['BOOKING_CANCELLATION'],
          },
        },
      })
    );

    // Create DLQ for refund subscriber failures
    const refundSubscriberDLQ = new Queue(this, 'RefundSubscriberDLQ', {
      queueName: `${this.getConfigValue('refundRequestTopicName')}-refund-subscriber-dlq`,
      retentionPeriod: Duration.days(14),
    });

    // For refund subscriber queue (SNS -> SQS -> Lambda)
    const refundRequestQueue = new Queue(this, 'RefundRequestQueue', {
      queueName: `${this.getConfigValue('refundRequestTopicName')}-refund-request-queue`,
      visibilityTimeout: Duration.seconds(120), // 2 minutes for DB + SQS operations
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: {
        queue: refundSubscriberDLQ,
        maxReceiveCount: 3,
      },
    });

    this.refundRequestTopic.addSubscription(
      new SqsSubscription(refundRequestQueue, {
        rawMessageDelivery: false,
      })
    );

    this.refundRequestTopic.addSubscription(
      new LambdaSubscription(this.refundSubscriber)
    );

    // Export References for other stacks to consume

    // Booking Notification Topic ARN
    this.exportReference(this, 'bookingNotificationTopicArn', this.bookingNotificationTopic.topicArn, 
      `ARN of the booking notification topic in ${this.stackId}`);

    // Refund Request Topic ARN
    this.exportReference(this, 'refundRequestTopicArn', this.refundRequestTopic.topicArn, 
      `ARN of the refund request topic in ${this.stackId}`);

    // Bind resolver functions to scope for other stacks to consume
    scope.resolveBookingNotificationTopic = this.resolveBookingNotificationTopic.bind(this);
    scope.resolveRefundRequestTopic = this.resolveRefundRequestTopic.bind(this);
    scope.resolveBookingNotificationTopicArn = this.resolveBookingNotificationTopicArn.bind(this);
    scope.resolveRefundRequestTopicArn = this.resolveRefundRequestTopicArn.bind(this);

    // Direct getters (for constructs within the same deployment)
    scope.getBookingNotificationTopic = this.getBookingNotificationTopic.bind(this);
    scope.getRefundRequestTopic = this.getRefundRequestTopic.bind(this);
  }

  // Getters for resources (used within the same deployment)
  getBookingNotificationTopic() {
    return this.bookingNotificationTopic;
  }

  getRefundRequestTopic() {
    return this.refundRequestTopic;
  }

  // Resolver functions for cross-stack references
  resolveBookingNotificationTopic(consumerScope) {
    const topicArn = this.resolveReference(consumerScope, this.getExportSSMPath('bookingNotificationTopicArn'));
    return Topic.fromTopicArn(consumerScope, `${this.getConstructId('bookingNotificationTopic')}-imported`, topicArn);
  }

  resolveRefundRequestTopic(consumerScope) {
    const topicArn = this.resolveReference(consumerScope, this.getExportSSMPath('refundRequestTopicArn'));
    return Topic.fromTopicArn(consumerScope, `${this.getConstructId('refundRequestTopic')}-imported`, topicArn);
  }

  resolveBookingNotificationTopicArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('bookingNotificationTopicArn'));
  }

  resolveRefundRequestTopicArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('refundRequestTopicArn'));
  }
}

async function createBookingWorkflowStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new BookingWorkflowStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Booking Workflow Stack: ${error}`);
  }
}

module.exports = {
  createBookingWorkflowStack
};
