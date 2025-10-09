/**
 * CDK resources for the email dispatch system using SQS and SES.
 */
const sqs = require('aws-cdk-lib/aws-sqs');
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const lambdaEventSources = require('aws-cdk-lib/aws-lambda-event-sources');
const iam = require('aws-cdk-lib/aws-iam');
const s3 = require('aws-cdk-lib/aws-s3');
const { Duration } = require('aws-cdk-lib');
const { CfnOutput } = require('aws-cdk-lib');

function emailDispatchSetup(scope, props) {
  console.log('Email Dispatch setup...');

  // SQS Dead Letter Queue for failed email processing
  const emailDlq = new sqs.Queue(scope, 'EmailDispatchDlq', {
    queueName: `ReserveRecEmailDlq-${props.env.environmentName}`,
    retentionPeriod: Duration.days(14),
  });

  // SQS Queue for email dispatch
  const emailQueue = new sqs.Queue(scope, 'EmailDispatchQueue', {
    queueName: `ReserveRecEmailQueue-${props.env.environmentName}`,
    visibilityTimeout: Duration.minutes(5), // Lambda timeout + buffer
    deadLetterQueue: {
      queue: emailDlq,
      maxReceiveCount: 3,
    },
    retentionPeriod: Duration.days(14),
  });

  // S3 Bucket for email templates (if not using local templates)
  const templateBucket = new s3.Bucket(scope, 'EmailTemplatesBucket', {
    bucketName: `reserve-rec-email-templates-${props.env.environmentName}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryptionKey: props.env.KMS_KEY,
    versioned: true, // Version templates for rollback capability
  });

  // Email dispatch Lambda function
  const emailDispatchFunction = new NodejsFunction(scope, 'EmailDispatchFunction', {
    code: lambda.Code.fromAsset('lib/handlers/emailDispatch'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: {
      ...props.env,
      EMAIL_QUEUE_URL: emailQueue.queueUrl,
      TEMPLATE_BUCKET_NAME: templateBucket.bucketName,
      SES_FROM_EMAIL: props.env.SES_FROM_EMAIL || 'noreply@bcparks.ca',
      SES_REGION: props.env.SES_REGION || 'ca-central-1',
    },
    layers: props.layers,
    timeout: Duration.minutes(3),
    memorySize: 512,
  });

  // Add SQS event source to trigger Lambda
  emailDispatchFunction.addEventSource(
    new lambdaEventSources.SqsEventSource(emailQueue, {
      batchSize: 1, // Process one email at a time for better error handling
      maxBatchingWindow: Duration.seconds(5),
    })
  );

  // Grant permissions to the Lambda function
  emailQueue.grantConsumeMessages(emailDispatchFunction);
  emailDlq.grantConsumeMessages(emailDispatchFunction);
  templateBucket.grantRead(emailDispatchFunction);

  // SES permissions
  emailDispatchFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: [
      'ses:SendEmail',
      'ses:SendRawEmail',
      'ses:GetSendQuota',
      'ses:GetSendStatistics',
    ],
    resources: ['*'], // SES resources are region-based
  }));

  // CloudWatch Logs permissions for debugging
  emailDispatchFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: [
      'logs:CreateLogGroup',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
    ],
    resources: ['*'],
  }));

  // Outputs
  new CfnOutput(scope, 'EmailQueueUrl', {
    value: emailQueue.queueUrl,
    description: 'Email Dispatch Queue URL',
    exportName: `EmailQueueUrl-${props.env.environmentName}`,
  });

  new CfnOutput(scope, 'EmailQueueArn', {
    value: emailQueue.queueArn,
    description: 'Email Dispatch Queue ARN',
    exportName: `EmailQueueArn-${props.env.environmentName}`,
  });

  new CfnOutput(scope, 'EmailTemplateBucketName', {
    value: templateBucket.bucketName,
    description: 'Email Templates S3 Bucket Name',
    exportName: `EmailTemplateBucketName-${props.env.environmentName}`,
  });

  return {
    emailQueue,
    emailDlq,
    templateBucket,
    emailDispatchFunction,
  };
}

module.exports = {
  emailDispatchSetup,
};