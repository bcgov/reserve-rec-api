const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    activitiesCollectionIdGetFunction:{
      name: 'ActivitiesColIdGET',
    },
    activitiesCollectionIdPostFunction:{
      name: 'ActivitiesColIdPOST',
    },
    activitiesCollectionIdPutFunction:{
      name: 'ActivitiesColIdPUT',
    },
    activitiesCollectionIdDeleteFunction:{
      name: 'ActivitiesColIdDELETE',
    }
  }
}

class ActivitiesConstruct extends LambdaConstruct {
  constructor(scope, id,  props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'admin';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /activities resource
    this.activitiesResource = this.resolveApi().root.addResource('activities');

    // Add /activities/{collectionId} resource
    this.activitiesCollectionIdResource = this.activitiesResource.addResource('{collectionId}');

    // Add /activities/{collectionId}/{activityType}/{activitiyId} resource
    this.activitiesActivityIdResource = this.activitiesCollectionIdResource.addResource('{actvityType}').addResource('{activityId}');

    // Activities GET by Collection ID Lambda Function
    this.activitiesCollectionIdGetFunction = this.generateBasicLambdaFn(
      scope,
      'activitiesCollectionIdGetFunction',
      'src/handlers/activities/_collectionId/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /activities/{collectionId}
    this.activitiesCollectionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.activitiesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /activities/{collectionId}/{activityType}/{activityId}
    this.activitiesActivityIdResource.addMethod('GET', new apigw.LambdaIntegration(this.activitiesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Activities POST by Collection ID Lambda Function
    this.activitiesCollectionIdPostFunction = this.generateBasicLambdaFn(
      scope,
      'activitiesCollectionIdPostFunction',
      'src/handlers/activities/_collectionId/POST',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // POST /activities/{collectionId}
    this.activitiesCollectionIdResource.addMethod('POST', new apigw.LambdaIntegration(this.activitiesCollectionIdPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Activities PUT by Collection ID Lambda Function
    this.activitiesCollectionIdPutFunction = this.generateBasicLambdaFn(
      scope,
      'activitiesCollectionIdPutFunction',
      'src/handlers/activities/_collectionId/PUT',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // PUT /activities/{collectionId}
    this.activitiesCollectionIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.activitiesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // PUT /activities/{collectionId}/{activityType}/{activitiyId}
    this.activitiesActivityIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.activitiesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Activities DELETE by Collection ID Lambda Function
    this.activitiesCollectionIdDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'activitiesCollectionIdDeleteFunction',
      'src/handlers/activities/_collectionId/DELETE',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // DELETE /activities/{collectionId}/{activityType}/{activityId}
    this.activitiesActivityIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.activitiesCollectionIdDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to all functions
    const functions = [
      this.activitiesCollectionIdGetFunction,
      this.activitiesCollectionIdPostFunction,
      this.activitiesCollectionIdPutFunction,
      this.activitiesCollectionIdDeleteFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }

  }
}

module.exports = {
  ActivitiesConstruct,
};