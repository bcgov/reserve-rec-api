const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const { logger } = require("../../../lib/helpers/utils");
const apigw = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const { Duration } = require("aws-cdk-lib");

const defaults = {
  resources: {
    protectedAreasGetFunction: {
      name: 'ProtectedAreasGET',
    },
    protectedAreasPostFunction: {
      name: 'ProtectedAreasPOST',
    },
    protectedAreasDeleteFunction: {
      name: 'ProtectedAreasDELETE',
    },
    protectedAreasOrcsGetFunction: {
      name: 'ProtectedAreasOrcsGET',
    },
    protectedAreasOrcsPostFunction: {
      name: 'ProtectedAreasOrcs-POST',
    },
    protectedAreasOrcsPutFunction: {
      name: 'ProtectedAreasOrcsPUT',
    },
    protectedAreasOrcsDeleteFunction: {
      name: 'ProtectedAreasOrcsDELETE',
    }
  }
};

class ProtectedAreasConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // Add /protected-areas resource
    this.protectedAreasResource = this.resolveApi().root.addResource('protected-areas');

    // Protected Areas GET Lambda Function
    this.protectedAreasGetFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasGetFunction',
      'src/handlers/protectedAreas/GET',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasResource.addMethod('GET', new apigw.LambdaIntegration(this.protectedAreasGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Protected Areas POST Lambda Function
    this.protectedAreasPostFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasPostFunction',
      'src/handlers/protectedAreas/POST',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasResource.addMethod('POST', new apigw.LambdaIntegration(this.protectedAreasPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Protected Areas DELETE Lambda Function
    this.protectedAreasDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasDeleteFunction',
      'src/handlers/protectedAreas/DELETE',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasResource.addMethod('DELETE', new apigw.LambdaIntegration(this.protectedAreasDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add /protected-areas/{orcs} resource
    this.protectedAreasByOrcsResource = this.protectedAreasResource.addResource('{orcs}');

    // Protected Areas GET by ORCS Lambda Function
    this.protectedAreasOrcsGetFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasOrcsGetFunction',
      'src/handlers/protectedAreas/_orcs/GET',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasByOrcsResource.addMethod('GET', new apigw.LambdaIntegration(this.protectedAreasOrcsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Protected Areas POST by ORCS Lambda Function
    this.protectedAreasOrcsPostFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasOrcsPostFunction',
      'src/handlers/protectedAreas/_orcs/POST',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasByOrcsResource.addMethod('POST', new apigw.LambdaIntegration(this.protectedAreasOrcsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Protected Areas PUT by ORCS Lambda Function
    this.protectedAreasOrcsPutFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasOrcsPutFunction',
      'src/handlers/protectedAreas/_orcs/PUT',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasByOrcsResource.addMethod('PUT', new apigw.LambdaIntegration(this.protectedAreasOrcsPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Protected Areas DELETE by ORCS Lambda Function
    this.protectedAreasOrcsDeleteFunction = this.generateBasicLambdaFn(
      scope,
      'protectedAreasOrcsDeleteFunction',
      'src/handlers/protectedAreas/_orcs/DELETE',
      'admin.handler',
      {
        basicReadWrite: true,
      }
    );

    this.protectedAreasByOrcsResource.addMethod('DELETE', new apigw.LambdaIntegration(this.protectedAreasOrcsDeleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to all functions

    const functions = [
      this.protectedAreasGetFunction,
      this.protectedAreasPostFunction,
      this.protectedAreasDeleteFunction,
      this.protectedAreasOrcsGetFunction,
      this.protectedAreasOrcsPostFunction,
      this.protectedAreasOrcsPutFunction,
      this.protectedAreasOrcsDeleteFunction,
    ];

    for (const func of functions) {
      this.grantBasicRefDataTableReadWrite(func);
    }
  }
}

module.exports = {
  ProtectedAreasConstruct,
};