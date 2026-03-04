const { Duration } = require("aws-cdk-lib");
const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    inventoryGetFunction: {
      name: 'InventoryGET',
    },
    inventoryPostFunction: {
      name: 'InventoryPOST',
    },
    inventoryPutFunction: {
      name: 'InventoryPUT',
    },
    inventoryDeleteFunction: {
      name: 'InventoryDELETE',
    }
  }
};

class InventoryConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /inventory resource
    this.inventoryResource = this.resolveApi().root.addResource('inventory');

    // Add /inventory/{collectionId}/{activityType}/{activityId}/{productId} resource
    this.inventoryByProductResource = this.inventoryResource.addResource('{collectionId}').addResource('{activityType}').addResource('{activityId}').addResource('{productId}');

    // Inventory GET by Product ID and Dates Lambda Function

    this.inventoryGetByProductFunction = this.generateBasicLambdaFn(
      scope,
      'inventoryGetFunction',
      'src/handlers/inventory/GET',
      handlerName,
      {
        basicRead: true,
      }
    );

    // Inventory POST by Product ID and Dates Lambda Function

    this.inventoryPostByProductFunction = this.generateBasicLambdaFn(
      scope,
      'inventoryPostFunction',
      'src/handlers/inventory/POST',
      handlerName,
      {
        basicReadWrite: true,
        timeout: Duration.minutes(1),
      }
    );

    // Inventory DELETE by Product ID and Dates Lambda Function

    this.inventoryDeleteByProductFunction = this.generateBasicLambdaFn(
      scope,
      'inventoryDeleteFunction',
      'src/handlers/inventory/DELETE',
      handlerName,
      {
        basicReadWrite: true,
        timeout: Duration.minutes(1),
      }
    );

    // GET /inventory/{collectionId}/{activityType}/{activityId}/{productId}?date=YYYY-MM-DD will be used to fetch Inventory records for a given Product on a specific date.

    this.inventoryByProductResource.addMethod('GET', new apigw.LambdaIntegration(this.inventoryGetByProductFunction, {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    }));

    // POST /inventory/{collectionId}/{activityType}/{activityId}/{productId} will be used to create Inventory records for a given Product and date range. The request body should include the date range and the inventory level for each date in the range. This will allow us to create Inventory records for each date in the range with the appropriate inventory level.

    this.inventoryByProductResource.addMethod('POST', new apigw.LambdaIntegration(this.inventoryPostByProductFunction, {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    }));

    // DELETE /inventory/{collectionId}/{activityType}/{activityId}/{productId} will be used to delete Inventory records for a given Product and date range. The request body should include the date range.

    this.inventoryByProductResource.addMethod('DELETE', new apigw.LambdaIntegration(this.inventoryDeleteByProductFunction, {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    }));
  }
}

module.exports = {
  InventoryConstruct,
}