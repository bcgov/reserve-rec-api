const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { ProductDatesConstruct } = require('../../../src/handlers/productDates/constructs');
const { InventoryPoolsConstruct } = require('../../../src/handlers/inventoryPools/constructs');
const { InventoryConstruct } = require('../../../src/handlers/inventory/constructs');

class ProductManagementNestedStack extends NestedStack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Provide a concrete identifier for child constructs to use (instead of token-based stackId)
    // This is used by LambdaConstruct for building resource IDs
    this.concreteStackId = `${scope.stackId}-AdmPM`;
    this.createScopedId = scope.createScopedId?.bind(scope);
    this.getAppName = scope.getAppName;
    this.getDeploymentName = scope.getDeploymentName;
    this.appScope = scope.appScope;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    // Initialize ProductDatesConstruct
    this.productDatesConstruct = new ProductDatesConstruct(this, 'ProductDatesConstruct', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });

    // Initialize InventoryConstruct
    this.inventoryConstruct = new InventoryConstruct(this, 'InventoryConstruct', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });

    // Initialize InventoryPoolsConstruct
    this.inventoryPoolsConstruct = new InventoryPoolsConstruct(this, 'InventoryPoolsConstruct', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });

  }
}

module.exports = { ProductManagementNestedStack };
