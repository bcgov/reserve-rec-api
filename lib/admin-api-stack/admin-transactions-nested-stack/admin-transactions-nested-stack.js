'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const {
  AdminTransactionsConstruct,
  PAYMENT_POST_EVENTS,
  PAYMENT_RECONCILE_EVENTS,
} = require('../../../src/handlers/transactions/constructs');
const { addEventMetrics, eventMetricNamespace } = require('../../helpers/event-metrics');

/**
 * NestedStack for Admin Transactions API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 *
 * For local development with SAM, the parent stack will instantiate AdminTransactionsConstruct
 * directly instead of using this NestedStack (SAM doesn't support nested stacks).
 */
class AdminTransactionsNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-AdmTXN`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.adminTransactionsConstruct = new AdminTransactionsConstruct(this, 'AdminTransactions', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
      refundRequestTopicArn: props.refundRequestTopicArn,
      kmsKey: props.kmsKey,
      emailQueueUrl: props.emailQueueUrl,
      emailQueueArn: props.emailQueueArn,
      smsReminderQueueUrl: props.smsReminderQueueUrl,
      smsReminderQueueArn: props.smsReminderQueueArn,
    });

    // The payment alarms live on the admin POST, the payment function deployed everywhere; the
    // public POST and reconcile functions feed the same metrics without alarms.
    const namespace = eventMetricNamespace(this.getDeploymentName());
    const construct = this.adminTransactionsConstruct;
    addEventMetrics(construct.transactionsAdminPostFunction, namespace, PAYMENT_POST_EVENTS, props.eventAlarms || {});
    addEventMetrics(construct.transactionsAdminReconcileFunction, namespace, PAYMENT_RECONCILE_EVENTS, {}, { alarms: false });
  }
}

module.exports = { AdminTransactionsNestedStack };
