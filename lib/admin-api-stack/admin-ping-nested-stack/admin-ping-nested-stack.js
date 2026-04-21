'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PingApiConstruct } = require('../../../src/handlers/ping/constructs');

/**
 * NestedStack for Admin Ping API endpoints
 * 
 * The API Gateway is now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references.
 */
class PingNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-AdmPING`;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.pingApiConstruct = new PingApiConstruct(this, 'AdminPingApi', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
    });
  }
}

module.exports = { PingNestedStack };
