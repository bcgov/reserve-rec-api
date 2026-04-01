'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { AdminFacilitiesConstruct } = require('../../../src/handlers/facilities/constructs');

class FacilitiesNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-FA`;

    this.adminFacilitiesConstruct = new AdminFacilitiesConstruct(this, 'Facilities', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
    });
  }
}

module.exports = { FacilitiesNestedStack };
