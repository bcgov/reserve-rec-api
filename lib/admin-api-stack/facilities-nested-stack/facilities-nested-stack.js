'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { FacilitiesConstruct } = require('../../../src/handlers/facilities/constructs');

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

    this.facilitiesConstruct = new FacilitiesConstruct(this, 'Facilities', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { FacilitiesNestedStack };
