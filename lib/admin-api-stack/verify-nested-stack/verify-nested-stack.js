'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { VerifyConstruct } = require('../../../src/handlers/verify/constructs');

/**
 * NestedStack for Admin Verify (QR code) API endpoints
 *
 * This wrapper allows the Verify functionality to be deployed as a nested stack
 * to work around CloudFormation's 500 resource limit per stack.
 */
class VerifyNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    // Propagate scope helpers from parent stack so LambdaConstructs work inside NestedStack
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;

    this.verifyConstruct = new VerifyConstruct(this, 'Verify', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = {
  VerifyNestedStack,
};
