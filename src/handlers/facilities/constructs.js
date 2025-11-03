const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    facilitiesCollectionIdGetFunction:{
      name: 'FacilitiesColIdGET',
    },
    facilitiesCollectionIdPostFunction:{
      name: 'FacilitiesColIdPOST',
    },
    facilitiesCollectionIdPutFunction:{
      name: 'FacilitiesColIdPUT',
    },
    facilitiesCollectionIdDeleteFunction:{
      name: 'FacilitiesColIdDELETE',
    }
  }
}

class FacilitiesConstruct extends LambdaConstruct {
  constructor(scope, id,  props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'public';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /facilities resource
    this.facilitiesResource = this.resolveApi().root.addResource('facilities');

    // Add /facilities/{collectionId} resource
    this.facilitiesCollectionIdResource = this.facilitiesResource.addResource('{collectionId}');

    // Add /facilities/{collectionId}/{facilityType} resource
    this.facilitiesFacilityTypeResource = this.facilitiesCollectionIdResource.addResource('{facilityType}');

    // Add /facilities/{collectionId}/{facilityId} resource
    this.facilitiesFacilityIdResource = this.facilitiesFacilityTypeResource.addResource('{facilityId}');

    // Facilities GET by Collection ID Lambda Function
    this.facilitiesCollectionIdGetFunction = this.generateBasicLambdaFn(
      scope,
      'facilitiesCollectionIdGetFunction',
      'src/handlers/facilities/_collectionId/GET',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // GET /facilities/{collectionId}
    this.facilitiesCollectionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.facilitiesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /facilities/{collectionId}/{facilityType}
    this.facilitiesFacilityTypeResource.addMethod('GET', new apigw.LambdaIntegration(this.facilitiesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /facilities/{collectionId}/{facilityType}/{facilityId}
    this.facilitiesFacilityIdResource.addMethod('GET', new apigw.LambdaIntegration(this.facilitiesCollectionIdGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Facilities POST by Collection ID Lambda Function
    this.facilitiesCollectionIdPostFunction = this.generateBasicLambdaFn(
      scope,
      'facilitiesCollectionIdPostFunction',
      'src/handlers/facilities/_collectionId/POST',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // POST /facilities/{collectionId}
    this.facilitiesCollectionIdResource.addMethod('POST', new apigw.LambdaIntegration(this.facilitiesCollectionIdPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /facilities/{collectionId}/{facilityType}
    this.facilitiesFacilityTypeResource.addMethod('POST', new apigw.LambdaIntegration(this.facilitiesCollectionIdPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Facilities PUT by Collection ID Lambda Function
    this.facilitiesCollectionIdPutFunction = this.generateBasicLambdaFn(
      scope,
      'facilitiesCollectionIdPutFunction',
      'src/handlers/facilities/_collectionId/PUT',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // PUT /facilities/{collectionId}
    this.facilitiesCollectionIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.facilitiesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // PUT /facilities/{collectionId}/{facilityType}
    this.facilitiesFacilityTypeResource.addMethod('PUT', new apigw.LambdaIntegration(this.facilitiesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // PUT /facilities/{collectionId}/{facilityType}/{facilityId}
    this.facilitiesFacilityIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.facilitiesCollectionIdPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Facilities DELETE by Collection ID Lambda Function
    this.facilitiesCollectionIdDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'facilitiesCollectionIdDeleteFunction',
      'src/handlers/facilities/_collectionId/DELETE',
      handlerName,
      {
        basicReadWrite: true,
      }
    );

    // DELETE /facilities/{collectionId}/{facilityType}/{facilityId}
    this.facilitiesFacilityIdResource.addMethod('DELETE', new apigw.LambdaIntegration(this.facilitiesCollectionIdDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to all functions
    const functions = [
      this.facilitiesCollectionIdGetFunction,
      this.facilitiesCollectionIdPostFunction,
      this.facilitiesCollectionIdPutFunction,
      this.facilitiesCollectionIdDeleteFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }

  }
}

module.exports = {
  FacilitiesConstruct,
};