'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { AdminConfigLambdas } = require('../../../src/handlers/config/constructs');

/**
 * NestedStack for Admin Config API endpoints
 * 
 * The API Gateway is now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references.
 */
class AdminConfigNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-AdmCFG`;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.adminConfigLambdas = new AdminConfigLambdas(this, 'AdminConfig', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
    });
  }
}

module.exports = { AdminConfigNestedStack };
