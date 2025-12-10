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
const path = require('path');

const defaults = {
  constructs: {
    bookingNotificationTopic: {
      name: 'BookingNotificationTopic',
    },
    refundRequestTopic: {
      name: 'RefundRequestTopic',
    },
    worldlineDeadLetterQueue: {
      name: 'WorldlineDeadLetterQueue',
    },
    worldlineRequestQueue: {
      name: 'WorldlineRequestQueue',
    },
    bookingCancellationSubscriber: {
      name: 'BookingCancellationSubscriber',
    },
    refundSubscriber: {
      name: 'RefundSubscriber',
    },
    worldlineProcessor: {
      name: 'WorldlineProcessor',
    },
    refundSubscriberDLQ: {
      name: 'RefundSubscriberDLQ',
    },
    refundRequestQueue: {
      name: 'RefundRequestQueue',
    },
  },
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
    // Topic configuration - note: actual names will be prefixed with app name and deployment name
    bookingNotificationTopicBaseName: 'booking-notifications',
    refundRequestTopicBaseName: 'refund-requests',
    // Subscription configuration
    enableEmailSubscriptions: false,
    // Topic retention and policies
    topicRemovalPolicy: 'retain',
    enableTopicEncryption: true,
    // Refund workflow configuration
    enableRefundWorkflow: true,
    refundDispatchBatchSize: 1, // process one refund at a time
    refundDispatchMaxBatchingWindow: 5, // seconds
    worldlineDispatchBatchSize: 1, // process one Worldline request at a time
    worldlineDispatchMaxBatchingWindow: 5, // seconds
  },
  secrets: {
    merchantId: {
      name: 'MerchantId',
    },
    hashKey: {
      name: 'HashKey',
    },
  },
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

    // Create environment-specific resource names
    const bookingNotificationTopicName = `${this.getAppName()}-${this.getDeploymentName()}-${this.getConfigValue('bookingNotificationTopicBaseName')}`;
    const refundRequestTopicName = `${this.getAppName()}-${this.getDeploymentName()}-${this.getConfigValue('refundRequestTopicBaseName')}`;

    // Create SNS Topics

    // Booking-specific notification topic
    this.bookingNotificationTopic = new Topic(this, this.getConstructId('bookingNotificationTopic'), {
      topicName: bookingNotificationTopicName,
      displayName: `${this.getAppName()} - ${this.getDeploymentName()} - Booking Notifications`,
      masterKey: kmsKey,
    });

    // Refund Request Topic - Fan-out pattern for coordinated refunds
    this.refundRequestTopic = new Topic(this, this.getConstructId('refundRequestTopic'), {
      topicName: refundRequestTopicName,
      displayName: `${this.getAppName()} - ${this.getDeploymentName()} - Refund Requests`,
      masterKey: kmsKey,
    });

    // Create Dead Letter Queue for failed Worldline requests
    this.worldlineDeadLetterQueue = new Queue(this, this.getConstructId('worldlineDeadLetterQueue'), {
      queueName: `${refundRequestTopicName}-worldline-dlq`,
      retentionPeriod: Duration.days(14),
      // Add CloudWatch alarm for DLQ messages
      messageRetentionPeriod: Duration.days(14),
    });

    // Create SQS Queue for Worldline API requests
    this.worldlineRequestQueue = new Queue(this, this.getConstructId('worldlineRequestQueue'), {
      queueName: `${refundRequestTopicName}-worldline-requests`,
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
    this.bookingCancellationSubscriber = new NodejsFunction(this, this.getConstructId('bookingCancellationSubscriber'), {
      functionName: `${this.getAppName()}-${this.getDeploymentName()}-BookingCancellationSubscriber`,
      entry: path.join(__dirname, '../handlers/bookingCancellationSubscriber/index.js'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        externalModules: [
          '@aws-sdk/*',
          '/opt/*'
        ],
        minify: false,
      },
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        REFUND_REQUEST_TOPIC_ARN: this.refundRequestTopic.topicArn,
      },
      layers: [baseLayer, awsUtilsLayer],
      timeout: Duration.seconds(30),
    });

    // Refund Subscriber Lambda
    this.refundSubscriber = new NodejsFunction(this, this.getConstructId('refundSubscriber'), {
      functionName: `${this.getAppName()}-${this.getDeploymentName()}-RefundSubscriber`,
      entry: path.join(__dirname, '../handlers/refundSubscriber/index.js'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        externalModules: [
          '@aws-sdk/*',
          '/opt/*'
        ],
        minify: false,
      },
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        WORLDLINE_REQUEST_QUEUE_URL: this.worldlineRequestQueue.queueUrl,
      },
      layers: [baseLayer, awsUtilsLayer],
      timeout: Duration.seconds(60),
    });

    // Worldline Processor Lambda
    this.worldlineProcessor = new NodejsFunction(this, this.getConstructId('worldlineProcessor'), {
      functionName: `${this.getAppName()}-${this.getDeploymentName()}-WorldlineProcessor`,
      entry: path.join(__dirname, '../handlers/worldlineProcessor/index.js'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        externalModules: [
          '@aws-sdk/*',
          '/opt/*'
        ],
        minify: false,
      },
      timeout: Duration.seconds(60),
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        MERCHANT_ID: this.getSecretValue('merchantId'),
        HASH_KEY: this.getSecretValue('hashKey'),
      },
      layers: [baseLayer, awsUtilsLayer],
      reservedConcurrentExecutions: 5,
    });

    // Connect SQS queue to Worldline processor Lambda
    this.worldlineProcessor.addEventSource(new SqsEventSource(this.worldlineRequestQueue, {
      batchSize: this.getConfigValue('worldlineDispatchBatchSize'),
      maxBatchingWindow: Duration.seconds(this.getConfigValue('worldlineDispatchMaxBatchingWindow')),
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

    
    // Grant KMS key permissions if encryption is enabled
    if (kmsKey) {
      kmsKey.grantEncryptDecrypt(this.bookingCancellationSubscriber);
    }
    
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
    const refundSubscriberDLQ = new Queue(this, this.getConstructId('refundSubscriberDLQ'), {
      queueName: `${refundRequestTopicName}-refund-subscriber-dlq`,
      retentionPeriod: Duration.days(14),
    });

    // For refund subscriber queue (SNS -> SQS -> Lambda)
    const refundRequestQueue = new Queue(this, this.getConstructId('refundRequestQueue'), {
      queueName: `${refundRequestTopicName}-refund-request-queue`,
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

    // Connect the refund subscriber Lambda to the SQS queue
    this.refundSubscriber.addEventSource(new SqsEventSource(refundRequestQueue, {
      batchSize: this.getConfigValue('refundDispatchBatchSize'),
      maxBatchingWindow: Duration.seconds(this.getConfigValue('refundDispatchMaxBatchingWindow')),
    }));

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
