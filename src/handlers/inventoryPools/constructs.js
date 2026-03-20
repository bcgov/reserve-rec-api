const { Duration } = require("aws-cdk-lib");
const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    inventoryPoolsGetFunction: {
      name: 'inventoryPoolsGET',
    },
    inventoryPoolsPostFunction: {
      name: 'inventoryPoolsPOST',
    },
    inventoryPoolsPutFunction: {
      name: 'inventoryPoolsPUT',
    },
    inventoryPoolsDeleteFunction: {
      name: 'inventoryPoolsDELETE',
    }
  }
};

class InventoryPoolsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /inventory-pools resource
    this.inventoryPoolsResource = this.resolveApi().root.addResource('inventory-pools');

    // Add /inventory-pools/{collectionId}/{activityType}/{activityId}/{productId} resource
    this.inventoryPoolsByProductResource = this.inventoryPoolsResource.addResource('{collectionId}').addResource('{activityType}').addResource('{activityId}').addResource('{productId}');

    // inventoryPools GET by Product ID and Dates Lambda Function

    this.inventoryPoolsGetByProductFunction = this.generateBasicLambdaFn(
      scope,
      'inventoryPoolsGetFunction',
      'src/handlers/inventoryPools/GET',
      handlerName,
      {
        basicRead: true,
      }
    );

    // inventoryPools POST by Product ID and Dates Lambda Function

    this.inventoryPoolsPostByProductFunction = this.generateBasicLambdaFn(
      scope,
      'inventoryPoolsPostFunction',
      'src/handlers/inventoryPools/POST',
      handlerName,
      {
        basicReadWrite: true,
        timeout: Duration.minutes(1),
      }
    );

    // inventoryPools DELETE by Product ID and Dates Lambda Function

    this.inventoryPoolsDeleteByProductFunction = this.generateBasicLambdaFn(
      scope,
      'inventoryPoolsDeleteFunction',
      'src/handlers/inventoryPools/DELETE',
      handlerName,
      {
        basicReadWrite: true,
        timeout: Duration.minutes(1),
      }
    );

    // GET /inventoryPools/{collectionId}/{activityType}/{activityId}/{productId}?date=YYYY-MM-DD will be used to fetch inventoryPools records for a given Product on a specific date.

    this.inventoryPoolsByProductResource.addMethod('GET', new apigw.LambdaIntegration(this.inventoryPoolsGetByProductFunction, {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    }));

    // POST /inventoryPools/{collectionId}/{activityType}/{activityId}/{productId} will be used to create inventoryPools records for a given Product and date range. The request body should include the date range and the inventoryPools level for each date in the range. This will allow us to create inventoryPools records for each date in the range with the appropriate inventoryPools level.

    this.inventoryPoolsByProductResource.addMethod('POST', new apigw.LambdaIntegration(this.inventoryPoolsPostByProductFunction, {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    }));

    // DELETE /inventoryPools/{collectionId}/{activityType}/{activityId}/{productId} will be used to delete inventoryPools records for a given Product and date range. The request body should include the date range.

    this.inventoryPoolsByProductResource.addMethod('DELETE', new apigw.LambdaIntegration(this.inventoryPoolsDeleteByProductFunction, {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    }));
  }
}

module.exports = {
  InventoryPoolsConstruct,
}