const { NestedStack } = require('aws-cdk-lib');
const { ProductDatesConstruct } = require('../../../src/handlers/productDates/constructs');
const { InventoryPoolsConstruct } = require('../../../src/handlers/inventoryPools/constructs');

class ProductManagementNestedStack extends NestedStack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Provide a concrete identifier for child constructs to use (instead of token-based stackId)
    // This is used by LambdaConstruct for building resource IDs
    this.concreteStackId = `${scope.stackId}-Pmgmt`;
    this.createScopedId = scope.createScopedId?.bind(scope);
    this.appScope = scope.appScope;

    // Initialize ProductDatesConstruct
    this.productDatesConstruct = new ProductDatesConstruct(this, 'ProductDatesConstruct', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });

    // // Initialize InventoryConstruct

    // Removing InventoryConstructfor now, we dont really need it yet. Need to save AWS resource counts. Always can reintroduce later

    // Initialize InventoryPoolsConstruct
    this.inventoryPoolsConstruct = new InventoryPoolsConstruct(this, 'InventoryPoolsConstruct', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });

  }
}

module.exports = { ProductManagementNestedStack };