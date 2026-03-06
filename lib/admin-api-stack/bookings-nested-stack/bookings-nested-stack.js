const { NestedStack } = require('aws-cdk-lib');
const { AdminBookingsConstruct } = require('../../../src/handlers/bookings/constructs');

/**
 * NestedStack for Admin Bookings API endpoints
 * 
 * This wrapper allows the Admin Bookings functionality to be deployed as a nested stack
 * to work around CloudFormation's 500 resource limit per stack.
 * 
 * For local development with SAM, the parent stack will instantiate AdminBookingsConstruct
 * directly instead of using this NestedStack (SAM doesn't support nested stacks).
 */
class BookingsNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-Bkgs`;
    this.createScopedId = scope.createScopedId?.bind(scope);
    this.appScope = scope.appScope;

    // Instantiate the AdminBookingsConstruct within this nested stack
    this.adminBookingsConstruct = new AdminBookingsConstruct(this, 'AdminBookings', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
      openSearchDomainArn: props.openSearchDomainArn,
    });
  }
}

module.exports = {
  BookingsNestedStack,
};
