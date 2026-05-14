'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { PublicBookingsConstruct } = require('../../../src/handlers/bookings/constructs');

/**
 * NestedStack for Public Bookings API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 *
 * For local development with SAM, the parent stack will instantiate PublicBookingsConstruct
 * directly instead of using this NestedStack (SAM doesn't support nested stacks).
 */
class PublicBookingsNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.getAppName = scope.getAppName;
    this.getDeploymentName = scope.getDeploymentName;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubBKG`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.publicBookingsConstruct = new PublicBookingsConstruct(this, 'PublicBookings', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
      kmsKey: props.kmsKey,
      // Pass the activities resource ID so the bookings nested stack
      // can import it via fromResourceAttributes()
      activitiesActivityIdResourceId: props.activitiesActivityIdResourceId,
    });

    // Add waiting room and SMS reminder props to the bookings POST Lambda
    const postFn = this.publicBookingsConstruct.bookingsPostFunction;

    if (props.waitingRoomTableName) {
      postFn.addEnvironment('WAITING_ROOM_TABLE_NAME', props.waitingRoomTableName);
    }
    if (props.hmacSigningKeyArn) {
      postFn.addEnvironment('HMAC_SIGNING_KEY_ARN', props.hmacSigningKeyArn);
    }
    if (props.smsReminderQueueUrl) {
      postFn.addEnvironment('SMS_REMINDER_QUEUE_URL', props.smsReminderQueueUrl);
    }
    if (props.waitingRoomTable) {
      props.waitingRoomTable.grantReadData(postFn);
    }
    if (props.hmacSigningKey) {
      props.hmacSigningKey.grantRead(postFn);
    }
    if (props.smsReminderQueueArn) {
      postFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        resources: [props.smsReminderQueueArn],
      }));
    }

    // Wire the email dispatch queue to the booking-complete Lambda so it can
    // enqueue confirmation emails.
    const completeFn = this.publicBookingsConstruct.bookingsCompleteFunction;
    if (props.emailQueueUrl) {
      completeFn.addEnvironment('EMAIL_QUEUE_URL', props.emailQueueUrl);
    }
    if (props.emailQueueArn) {
      completeFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        resources: [props.emailQueueArn],
      }));
      // The email queue is encrypted with the shared KMS key, so SendMessage
      // requires GenerateDataKey on that key as well.
      if (props.kmsKey) {
        completeFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
          resources: [props.kmsKey.keyArn],
        }));
      }
    }
  }
}

module.exports = { PublicBookingsNestedStack };
