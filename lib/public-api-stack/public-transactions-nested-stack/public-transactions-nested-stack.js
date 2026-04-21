'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { TransactionsConstruct } = require('../../../src/handlers/transactions/constructs');

/**
 * NestedStack for Public Transactions API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 *
 * For local development with SAM, the parent stack will instantiate TransactionsConstruct
 * directly instead of using this NestedStack (SAM doesn't support nested stacks).
 */
class PublicTransactionsNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-PubTXN`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.transactionsConstruct = new TransactionsConstruct(this, 'Transactions', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      refundRequestTopicArn: props.refundRequestTopicArn,
      kmsKey: props.kmsKey,
    });
  }
}

module.exports = { PublicTransactionsNestedStack };
