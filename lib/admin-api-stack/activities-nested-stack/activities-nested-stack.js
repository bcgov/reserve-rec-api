'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { ActivitiesConstruct } = require('../../../src/handlers/activities/constructs');

class ActivitiesNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-AC`;

    this.activitiesConstruct = new ActivitiesConstruct(this, 'Activities', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { ActivitiesNestedStack };
