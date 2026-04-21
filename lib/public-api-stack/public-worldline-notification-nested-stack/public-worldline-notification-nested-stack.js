'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { WorldlineNotificationConstruct } = require('../../../src/handlers/worldlineNotification/constructs');

/**
 * NestedStack for Public Worldline Notification API endpoints
 *
 * The API Gateway is now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references.
 */
class PublicWorldlineNotificationNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubWLN`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.worldlineNotificationConstruct = new WorldlineNotificationConstruct(this, 'WorldlineNotification', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      emailQueueUrl: props.emailQueueUrl,
      emailQueueArn: props.emailQueueArn,
      kmsKey: props.kmsKey,
    });
  }
}

module.exports = { PublicWorldlineNotificationNestedStack };
