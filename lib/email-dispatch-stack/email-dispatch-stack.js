const { BaseStack } = require('../helpers/base-stack');
const { Duration, RemovalPolicy } = require('aws-cdk-lib');
const sqs = require('aws-cdk-lib/aws-sqs');
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { SqsEventSource } = require('aws-cdk-lib/aws-lambda-event-sources');
const iam = require('aws-cdk-lib/aws-iam');
const s3 = require('aws-cdk-lib/aws-s3');
const { logger } = require('../helpers/utils');
const { StackPrimer } = require('../helpers/stack-primer');

const defaults = {
  description: 'Email Dispatch stack providing SQS queues, S3 template storage, and Lambda functions for email processing via AWS SES.',
  constructs: {
    emailDispatchQueue: {
      name: 'EmailDispatchQueue',
    },
    emailDispatchDlq: {
      name: 'EmailDispatchDlq',
    },
    emailTemplatesBucket: {
      name: 'EmailTemplatesBucket',
    },
    emailDispatchFunction: {
      name: 'EmailDispatchFunction',
    },
  },
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
    // Queue configuration
    emailQueueName: 'reserve-rec-email-queue',
    emailDlqName: 'reserve-rec-email-dlq',
    emailQueueVisibilityTimeout: 300, // 5 minutes (Lambda timeout + buffer)
    emailQueueRetentionPeriod: 14, // days
    emailDlqRetentionPeriod: 14, // days
    emailQueueMaxReceiveCount: 3,
    // S3 configuration
    emailTemplatesBucketName: 'reserve-rec-email-templates',
    enableTemplateBucketVersioning: true,
    // Lambda configuration
    emailDispatchFunctionTimeout: 180, // 3 minutes
    emailDispatchFunctionMemorySize: 512,
    emailDispatchBatchSize: 1, // Process one email at a time
    emailDispatchMaxBatchingWindow: 5, // seconds
    // SES configuration
    sesFromEmail: process.env.SES_FROM_EMAIL || 'noreply@bcparks.ca',
    sesRegion: process.env.SES_REGION || 'ca-central-1',
  },
};

class EmailDispatchStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Email Dispatch Stack: ${this.stackId}`);

    // Resolve dependencies from other stacks
    const kmsKey = scope.resolveKmsKey(this);

    // Resolve layers
    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);

    // Create Dead Letter Queue for failed email processing
    this.emailDispatchDlq = new sqs.Queue(this, this.getConstructId('emailDispatchDlq'), {
      queueName: `${this.getConfigValue('emailDlqName')}-${this.getDeploymentName()}`,
      retentionPeriod: Duration.days(this.getConfigValue('emailDlqRetentionPeriod')),
      encryptionMasterKey: kmsKey,
    });

    // Create SQS Queue for email dispatch
    this.emailDispatchQueue = new sqs.Queue(this, this.getConstructId('emailDispatchQueue'), {
      queueName: `${this.getConfigValue('emailQueueName')}-${this.getDeploymentName()}`,
      visibilityTimeout: Duration.seconds(this.getConfigValue('emailQueueVisibilityTimeout')),
      deadLetterQueue: {
        queue: this.emailDispatchDlq,
        maxReceiveCount: this.getConfigValue('emailQueueMaxReceiveCount'),
      },
      retentionPeriod: Duration.days(this.getConfigValue('emailQueueRetentionPeriod')),
      encryptionMasterKey: kmsKey,
    });

    // Create S3 Bucket for email templates
    this.emailTemplatesBucket = new s3.Bucket(this, this.getConstructId('emailTemplatesBucket'), {
      bucketName: `${this.getConfigValue('emailTemplatesBucketName')}-${this.getDeploymentName()}`.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryptionKey: kmsKey,
      versioned: this.getConfigValue('enableTemplateBucketVersioning'),
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Create Email Dispatch Lambda Function
    this.emailDispatchFunction = new NodejsFunction(this, this.getConstructId('emailDispatchFunction'), {
      functionName: `${this.getAppName()}-${this.getDeploymentName()}-EmailDispatch`,
      entry: 'lib/handlers/emailDispatch/index.js',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        EMAIL_QUEUE_URL: this.emailDispatchQueue.queueUrl,
        TEMPLATE_BUCKET_NAME: this.emailTemplatesBucket.bucketName,
        SES_FROM_EMAIL: this.getConfigValue('sesFromEmail'),
        SES_REGION: this.getConfigValue('sesRegion'),
        AWS_REGION: this.getRegion(),
      },
      layers: [baseLayer, awsUtilsLayer],
      timeout: Duration.seconds(this.getConfigValue('emailDispatchFunctionTimeout')),
      memorySize: this.getConfigValue('emailDispatchFunctionMemorySize'),
    });

    // Add SQS event source to trigger Lambda
    this.emailDispatchFunction.addEventSource(
      new SqsEventSource(this.emailDispatchQueue, {
        batchSize: this.getConfigValue('emailDispatchBatchSize'),
        maxBatchingWindow: Duration.seconds(this.getConfigValue('emailDispatchMaxBatchingWindow')),
      })
    );

    // Grant permissions to the Lambda function

    // SQS permissions
    this.emailDispatchQueue.grantConsumeMessages(this.emailDispatchFunction);
    this.emailDispatchDlq.grantConsumeMessages(this.emailDispatchFunction);

    // S3 permissions
    this.emailTemplatesBucket.grantRead(this.emailDispatchFunction);

    // SES permissions
    this.emailDispatchFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ses:SendEmail',
          'ses:SendRawEmail',
          'ses:GetSendQuota',
          'ses:GetSendStatistics',
        ],
        resources: ['*'], // SES resources are region-based, not resource-specific
      })
    );

    // CloudWatch Logs permissions (usually granted by default, but explicit is better)
    this.emailDispatchFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['*'],
      })
    );

    // Export References for other stacks to consume

    // Email Queue URL
    this.exportReference(
      this,
      'emailQueueUrl',
      this.emailDispatchQueue.queueUrl,
      `URL of the email dispatch queue in ${this.stackId}`
    );

    // Email Queue ARN
    this.exportReference(
      this,
      'emailQueueArn',
      this.emailDispatchQueue.queueArn,
      `ARN of the email dispatch queue in ${this.stackId}`
    );

    // Email Templates Bucket Name
    this.exportReference(
      this,
      'emailTemplatesBucketName',
      this.emailTemplatesBucket.bucketName,
      `Name of the email templates S3 bucket in ${this.stackId}`
    );

    // Email Templates Bucket ARN
    this.exportReference(
      this,
      'emailTemplatesBucketArn',
      this.emailTemplatesBucket.bucketArn,
      `ARN of the email templates S3 bucket in ${this.stackId}`
    );

    // Bind resolver functions to scope for other stacks to consume
    scope.resolveEmailQueueUrl = this.resolveEmailQueueUrl.bind(this);
    scope.resolveEmailQueueArn = this.resolveEmailQueueArn.bind(this);
    scope.resolveEmailTemplatesBucketName = this.resolveEmailTemplatesBucketName.bind(this);
    scope.resolveEmailTemplatesBucketArn = this.resolveEmailTemplatesBucketArn.bind(this);

    // Direct getters (for constructs within the same deployment)
    scope.getEmailDispatchQueue = this.getEmailDispatchQueue.bind(this);
    scope.getEmailTemplatesBucket = this.getEmailTemplatesBucket.bind(this);
  }

  // Getters for resources (used within the same deployment)
  getEmailDispatchQueue() {
    return this.emailDispatchQueue;
  }

  getEmailTemplatesBucket() {
    return this.emailTemplatesBucket;
  }

  // Resolver functions for cross-stack references
  resolveEmailQueueUrl(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('emailQueueUrl'));
  }

  resolveEmailQueueArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('emailQueueArn'));
  }

  resolveEmailTemplatesBucketName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('emailTemplatesBucketName'));
  }

  resolveEmailTemplatesBucketArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('emailTemplatesBucketArn'));
  }
}

async function createEmailDispatchStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new EmailDispatchStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Email Dispatch Stack: ${error}`);
  }
}

module.exports = {
  createEmailDispatchStack,
};
