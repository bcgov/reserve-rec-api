const { Duration } = require("aws-cdk-lib");
const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    productDatesGetFunction: {
      name: 'ProductDatesGET',
    },
    productDatesPostFunction: {
      name: 'ProductDatesPOST',
    },
    productDatesPutFunction: {
      name: 'ProductDatesPUT',
    },
    productDatesDeleteFunction: {
      name: 'ProductDatesDELETE',
    }
  }
};

class ProductDatesConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /product-dates resource
    this.productDatesResource = this.resolveApi().root.addResource('product-dates');

    // Add /product-dates/{collectionId}/{activityType}/{activityId}/{productId} resource
    this.productDatesByProductResource = this.productDatesResource.addResource('{collectionId}').addResource('{activityType}').addResource('{activityId}').addResource('{productId}');

    this.addCorsPreflightForResources([
      this.productDatesResource,
      this.productDatesByProductResource,
    ]);

    // // ProductDates GET by Product ID Lambda Function
    this.productDatesGetByDatesFunction = this.generateBasicLambdaFn(
      scope,
      'productDatesGetFunction',
      'src/handlers/productDates/_productId/GET',
      handlerName,
      {
        basicRead: true,
      }
    );

    // ProductDates POST by Product ID & dates Lambda Function
    this.productDatesPostByDatesFunction = this.generateBasicLambdaFn(
      scope,
      'productDatesPostFunction',
      'src/handlers/productDates/_productId/POST',
      handlerName,
      {
        basicReadWrite: true,
        timeout: Duration.minutes(1),
      }
    );

    // ProductDates DELETE by Product ID & dates Lambda Function
    this.productDatesDeleteByDatesFunction = this.generateBasicLambdaFn(
      scope,
      'productDatesDeleteFunction',
      'src/handlers/productDates/_productId/DELETE',
      handlerName,
      {
        basicReadWrite: true,
        timeout: Duration.minutes(1),
      }
    );

    // GET /product-dates/{collectionId}/{activityType}/{activityId}/{productId}
    this.productDatesByProductResource.addMethod('GET', new apigw.LambdaIntegration(this.productDatesGetByDatesFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /product-dates/{collectionId}/{activityType}/{activityId}/{productId}
    this.productDatesByProductResource.addMethod('POST', new apigw.LambdaIntegration(this.productDatesPostByDatesFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // DELETE /product-dates/{collectionId}/{activityType}/{activityId}/{productId}
    this.productDatesByProductResource.addMethod('DELETE', new apigw.LambdaIntegration(this.productDatesDeleteByDatesFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });
  }
}

class PublicProductDatesConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /public/product-dates/{collectionId}/{activityType}/{activityId}/{productId} resource
    // Add /product-dates resource
    this.productDatesResource = this.resolveApi().root.addResource('product-dates');

    this.productDatesByProductResource = this.productDatesResource.addResource('{collectionId}').addResource('{activityType}').addResource('{activityId}').addResource('{productId}');

    this.addCorsPreflightForResources([
      this.productDatesResource,
      this.productDatesByProductResource,
    ]);

    // // ProductDates GET by Product ID Lambda Function
    this.productDatesGetByDatesFunction = this.generateBasicLambdaFn(
      scope,
      'productDatesGetFunction',
      'src/handlers/productDates/_productId/GET',
      handlerName,
      {
        basicRead: true,
      }
    );

    // GET /product-dates/{collectionId}/{activityType}/{activityId}/{productId}
    this.productDatesByProductResource.addMethod('GET', new apigw.LambdaIntegration(this.productDatesGetByDatesFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });
  }
}

module.exports = {
  ProductDatesConstruct,
  PublicProductDatesConstruct
};