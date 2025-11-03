const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    geozonesCollectionIdGetFunction:{
      name: 'GeozonesColIdGET',
    },
    geozonesCollectionIdPostFunction:{
      name: 'GeozonesColIdPOST',
    },
    geozonesCollectionIdPutFunction:{
      name: 'GeozonesColIdPUT',
    },
    geozonesCollectionIdDeleteFunction:{
      name: 'GeozonesColIdDELETE',
    }
  }
}

class GeozonesConstruct extends LambdaConstruct {
  constructor(scope, id,  props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'public';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /geozones resource
    this.geozonesResource = this.resolveApi().root.addResource('geozones');

    // Add /geozones/{collectionId} resource
    this.geozonesCollectionIdResource = this.geozonesResource.addResource('{collectionId}');

    // Add /geozones/{collectionId}/{geozoneId} resource
    this.geozonesGeozoneIdResource = this.geozonesCollectionIdResource.addResource('{geozoneId}');

    // Geozones GET by Collection ID Lambda Function
    this.geozonesCollectionIdGetFunction = this.generateBasicLambdaFn(
      scope,
      'geozonesCollectionIdGetFunction',
      'src/handlers/geozones/_collectionId/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /geozones/{collectionId}
    this.geozonesCollectionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.geozonesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /geozones/{collectionId}/{geozoneId}
    this.geozonesGeozoneIdResource.addMethod('GET', new apigw.LambdaIntegration(this.geozonesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Geozones POST by Collection ID Lambda Function
    this.geozonesCollectionIdPostFunction = this.generateBasicLambdaFn(
      scope,
      'geozonesCollectionIdPostFunction',
      'src/handlers/geozones/_collectionId/POST',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // POST /geozones/{collectionId}
    this.geozonesCollectionIdResource.addMethod('POST', new apigw.LambdaIntegration(this.geozonesCollectionIdPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Geozones PUT by Collection ID Lambda Function
    this.geozonesCollectionIdPutFunction = this.generateBasicLambdaFn(
      scope,
      'geozonesCollectionIdPutFunction',
      'src/handlers/geozones/_collectionId/PUT',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // PUT /geozones/{collectionId}
    this.geozonesCollectionIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.geozonesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // PUT /geozones/{collectionId}/{geozoneId}
    this.geozonesGeozoneIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.geozonesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Geozones DELETE by Collection ID Lambda Function
    this.geozonesCollectionIdDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'geozonesCollectionIdDeleteFunction',
      'src/handlers/geozones/_collectionId/DELETE',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // DELETE /geozones/{collectionId}/{geozoneId}
    this.geozonesGeozoneIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.geozonesCollectionIdDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to all functions
    const functions = [
      this.geozonesCollectionIdGetFunction,
      this.geozonesCollectionIdPostFunction,
      this.geozonesCollectionIdPutFunction,
      this.geozonesCollectionIdDeleteFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }

  }
}

module.exports = {
  GeozonesConstruct,
};