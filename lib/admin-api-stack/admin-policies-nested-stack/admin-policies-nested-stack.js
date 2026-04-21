'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PoliciesConstruct } = require('../../../src/handlers/policies/constructs');

/**
 * NestedStack for Admin Policies API endpoints
 * 
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 */
class PoliciesNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-AdmPOL`;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.policiesConstruct = new PoliciesConstruct(this, 'Policies', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer, // Pass the authorizer object from parent stack
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { PoliciesNestedStack };
