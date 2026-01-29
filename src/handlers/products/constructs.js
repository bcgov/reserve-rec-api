const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    productsCollectionIdGetFunction:{
      name: 'ProductsColIdGET',
    },
    productsCollectionIdPostFunction:{
      name: 'ProductsColIdPOST',
    },
    productsCollectionIdPutFunction:{
      name: 'ProductsColIdPUT',
    },
    productsCollectionIdDeleteFunction:{
      name: 'ProductsColIdDELETE',
    }
  }
}

class ProductsConstruct extends LambdaConstruct {
  constructor(scope, id,  props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /products resource
    this.productsResource = this.resolveApi().root.addResource('products');

    // Add /products/{collectionId} resource
    this.productsCollectionIdResource = this.productsResource.addResource('{collectionId}');

    // Add /products/{collectionId}/{activityType}/{activityId} resource
    this.productsActivityIdResource = this.productsCollectionIdResource.addResource('{activityType}').addResource('{activityId}');

    // Add /products/{collectionId}/{activityType}/{activityId}/{productId} resource
    this.productsProductIdResource = this.productsActivityIdResource.addResource('{productId}');

    // Products GET by Collection ID Lambda Function
    this.productsCollectionIdGetFunction = this.generateBasicLambdaFn(
      scope,
      'productsCollectionIdGetFunction',
      'src/handlers/products/_collectionId/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /products/{collectionId}
    this.productsCollectionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.productsCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /products/{collectionId}/{activityType}/{activityId}
    this.productsActivityIdResource.addMethod('GET', new apigw.LambdaIntegration(this.productsCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Products POST by Collection ID Lambda Function
    this.productsCollectionIdPostFunction = this.generateBasicLambdaFn(
      scope,
      'productsCollectionIdPostFunction',
      'src/handlers/products/_collectionId/POST',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // POST /products/{collectionId}
    this.productsCollectionIdResource.addMethod('POST', new apigw.LambdaIntegration(this.productsCollectionIdPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Products PUT by Collection ID Lambda Function
    this.productsCollectionIdPutFunction = this.generateBasicLambdaFn(
      scope,
      'productsCollectionIdPutFunction',
      'src/handlers/products/_collectionId/PUT',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // PUT /products/{collectionId}
    this.productsCollectionIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.productsCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // PUT /products/{collectionId}/{activityType}/{activityId}/{productId}
    this.productsProductIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.productsCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Products DELETE by Collection ID Lambda Function
    this.productsCollectionIdDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'productsCollectionIdDeleteFunction',
      'src/handlers/products/_collectionId/DELETE',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // DELETE /products/{collectionId}/{activityType}/{activityId}/{productId}
    this.productsProductIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.productsCollectionIdDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to all functions
    const functions = [
      this.productsCollectionIdGetFunction,
      this.productsCollectionIdPostFunction,
      this.productsCollectionIdPutFunction,
      this.productsCollectionIdDeleteFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }

  }
}

module.exports = {
  ProductsConstruct,
};
