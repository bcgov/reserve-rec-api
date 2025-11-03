const { Duration } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { logger } = require('../../../lib/helpers/utils');
const { LambdaConstruct } = require('../../../lib/helpers/base-lambda');

class AdminConfigLambdas extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, props);

    logger.debug('Building Configuration Lambdas');

    this.configGetFunction = new NodejsFunction(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'admin.handler',
      code: lambda.Code.fromAsset('src/handlers/config/GET'),
      layers: props?.layers || [],
      environment: this.resolveEnvironment(),
      description: `Handles configuration get requests for the api: ${this.api?.restApiName}`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    this.configResource = this.api.root.addResource('config');

    // No authorization for this resource
    this.configResource.addMethod('GET', new apigateway.LambdaIntegration(this.configGetFunction), {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    this.grantBasicRefDataTableRead(this.configGetFunction);

  }
}

class PublicConfigLambdas extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, props);

    logger.debug('Building Configuration Lambdas');

    this.configGetFunction = new NodejsFunction(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'public.handler',
      code: lambda.Code.fromAsset('src/handlers/config/GET'),
      layers: props?.layers || [],
      environment: this.resolveEnvironment(),
      description: `Handles configuration get requests for the api: ${this.api?.restApiName}`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    this.configResource = this.api.root.addResource('config');

    // No authorization for this resource
    this.configResource.addMethod('GET', new apigateway.LambdaIntegration(this.configGetFunction), {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    this.grantBasicRefDataTableRead(this.configGetFunction);

  }
}

module.exports = {
  AdminConfigLambdas,
  PublicConfigLambdas
};