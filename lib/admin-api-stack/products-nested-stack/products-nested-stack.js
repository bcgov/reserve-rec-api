'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { ProductsConstruct } = require('../../../src/handlers/products/constructs');

class ProductsNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PR`;

    this.productsConstruct = new ProductsConstruct(this, 'Products', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { ProductsNestedStack };
