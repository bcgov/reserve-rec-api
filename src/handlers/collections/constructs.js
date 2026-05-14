const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    collectionsGetFunction: {
      name: 'ColGET',
    },
    collectionsCollectionIdGetFunction: {
      name: 'ColColIdGET',
    },
  }
};

const adminDefaults = {
  resources: {
    ...defaults.resources,
    collectionsPostFunction: {
      name: 'ColPOST',
    },
    collectionsCollectionIdPutFunction: {
      name: 'CollectColIdPUT',
    },
    collectionsCollectionIdDeleteFunction: {
      name: 'CollectColIdDELETE',
    },
  }
};

class PublicCollectionsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // Add /collections resource
    this.collectionsResource = this.resolveApi().root.addResource('collections');

    // Add /collections/{collectionId} resource
    this.collectionsCollectionIdResource = this.collectionsResource.addResource('{collectionId}');

    this.addCorsPreflightForResources([
      this.collectionsResource,
      this.collectionsCollectionIdResource,
    ]);

    // Collections GET Lambda Function
    this.collectionsGetFunction = this.generateBasicLambdaFn(
      scope,
      'collectionsGetFunction',
      'src/handlers/collections/GET',
      'public.handler',
      {
        basicReadWrite: true,
      }
    );

    // GET /collections
    this.collectionsResource.addMethod('GET', new apigw.LambdaIntegration(this.collectionsGetFunction), {
      authorizationType: apigw.AuthorizationType.NONE,
    });

    // GET /collections/{collectionId}
    this.collectionsCollectionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.collectionsGetFunction), {
      authorizationType: apigw.AuthorizationType.NONE,
    });

    this.grantBasicRefDataTableReadWrite(this.collectionsGetFunction);
  }
}

class AdminCollectionsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: adminDefaults
    });

    // Add /collections resource
    this.collectionsResource = this.resolveApi().root.addResource('collections');

    // Add /collections/{collectionId} resource
    this.collectionsCollectionIdResource = this.collectionsResource.addResource('{collectionId}');

    this.addCorsPreflightForResources([
      this.collectionsResource,
      this.collectionsCollectionIdResource,
    ]);

    // Collections GET Lambda Function
    this.collectionsGetFunction = this.generateBasicLambdaFn(
      scope,
      'collectionsGetFunction',
      'src/handlers/collections/GET',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    // GET /collections
    this.collectionsResource.addMethod('GET', new apigw.LambdaIntegration(this.collectionsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /collections/{collectionId}
    this.collectionsCollectionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.collectionsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Collections POST Lambda Function
    this.collectionsPostFunction = this.generateBasicLambdaFn(
      scope,
      'collectionsPostFunction',
      'src/handlers/collections/POST',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    // POST /collections
    this.collectionsResource.addMethod('POST', new apigw.LambdaIntegration(this.collectionsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Collections PUT Lambda Function
    this.collectionsCollectionIdPutFunction = this.generateBasicLambdaFn(
      scope,
      'collectionsCollectionIdPutFunction',
      'src/handlers/collections/PUT',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    // PUT /collections/{collectionId}
    this.collectionsCollectionIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.collectionsCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Collections DELETE Lambda Function
    this.collectionsCollectionIdDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'collectionsCollectionIdDeleteFunction',
      'src/handlers/collections/DELETE',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    // DELETE /collections/{collectionId}
    this.collectionsCollectionIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.collectionsCollectionIdDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    const functions = [
      this.collectionsGetFunction,
      this.collectionsPostFunction,
      this.collectionsCollectionIdPutFunction,
      this.collectionsCollectionIdDeleteFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }
  }
}

module.exports = {
  PublicCollectionsConstruct,
  AdminCollectionsConstruct,
};

