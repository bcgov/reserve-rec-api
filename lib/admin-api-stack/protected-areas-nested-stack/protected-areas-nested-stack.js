'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { ProtectedAreasConstruct } = require('../../../src/handlers/protectedAreas/constructs');

/**
 * NestedStack for Admin Protected Areas API endpoints
 *
 * This wrapper allows the ProtectedAreas functionality to be deployed as a nested stack
 * to work around CloudFormation's 500 resource limit per stack.
 */
class ProtectedAreasNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    // Propagate scope helpers from parent stack so LambdaConstructs work inside NestedStack
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    // Distinct prefix for Lambda function names inside this nested stack.
    // Without this, LambdaConstruct falls back to scope.stackId (the parent's ID),
    // producing the same function name as the existing inline construct → CF CREATE_FAILED.
    // Use a short suffix ("-PA") to avoid hitting the 64-char Lambda function name limit
    // (ProtectedAreasOrcsDELETE is 24 chars; longer suffixes exceed the cap).
    this.concreteStackId = `${scope.stackId}-PA`;

    this.protectedAreasConstruct = new ProtectedAreasConstruct(this, 'ProtectedAreas', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = {
  ProtectedAreasNestedStack,
};
