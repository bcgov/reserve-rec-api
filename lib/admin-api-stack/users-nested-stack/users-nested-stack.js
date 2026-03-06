const { NestedStack } = require('aws-cdk-lib');
const { UsersConstruct } = require('../../../src/handlers/users/constructs');

/**
 * NestedStack for Users API endpoints
 * 
 * This wrapper allows the Users functionality to be deployed as a nested stack
 * to work around CloudFormation's 500 resource limit per stack.
 * 
 * For local development with SAM, the parent stack will instantiate UsersConstruct
 * directly instead of using this NestedStack (SAM doesn't support nested stacks).
 */
class UsersNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    // Propagate scope helpers from parent stack so LambdaConstructs work inside NestedStack
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;

    // Provide a concrete identifier for child constructs to use (instead of token-based stackId)
    // This is used by LambdaConstruct for building resource IDs
    this.concreteStackId = `${scope.stackId}-Users`;
    this.createScopedId = scope.createScopedId?.bind(scope);
    this.appScope = scope.appScope;

    // Instantiate the UsersConstruct within this nested stack
    this.usersConstruct = new UsersConstruct(this, 'Users', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      openSearchDomainArn: props.openSearchDomainArn,
    });
  }
}

module.exports = {
  UsersNestedStack,
};
