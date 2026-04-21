'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { BCSCConstruct } = require('../../../src/handlers/bcsc/constructs');

/**
 * NestedStack for Admin BCSC API endpoints
 * 
 * The API Gateway is now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 */
class BCSCNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-AdmBCSC`;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.bcscConstruct = new BCSCConstruct(this, 'BCSC', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
    });
  }
}

module.exports = { BCSCNestedStack };
