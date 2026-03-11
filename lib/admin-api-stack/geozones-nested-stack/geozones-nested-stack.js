'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { GeozonesConstruct } = require('../../../src/handlers/geozones/constructs');

class GeozonesNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-GZ`;

    this.geozonesConstruct = new GeozonesConstruct(this, 'Geozones', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { GeozonesNestedStack };
