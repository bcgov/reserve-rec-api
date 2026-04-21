const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { UsersConstruct } = require('../../../src/handlers/users/constructs');

/**
 * NestedStack for Users API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
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
    this.concreteStackId = `${scope.stackId}-AdmUSR`;
    this.createScopedId = scope.createScopedId?.bind(scope);
    this.appScope = scope.appScope;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    // Instantiate the UsersConstruct within this nested stack with the imported API
    this.usersConstruct = new UsersConstruct(this, 'Users', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer, // Pass the authorizer object from parent stack
      openSearchDomainArn: props.openSearchDomainArn,
    });
  }
}

module.exports = {
  UsersNestedStack,
};
