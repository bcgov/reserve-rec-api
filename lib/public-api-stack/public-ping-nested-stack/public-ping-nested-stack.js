'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PingApiConstruct } = require('../../../src/handlers/ping/constructs');

/**
 * NestedStack for Public Ping API endpoints
 *
 * The API Gateway is now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references.
 */
class PublicPingNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-PubPING`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.pingApiConstruct = new PingApiConstruct(this, 'PubPingApi', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
    });
  }
}

module.exports = { PublicPingNestedStack };
