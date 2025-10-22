const { Duration } = require('aws-cdk-lib');
const { Construct } = require('constructs');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { logger } = require('../../lib/utils');

class AdminConfigLambdas extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, props);

    this.configGetFunction = new NodejsFunction(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'admin.handler',
      code: lambda.Code.fromAsset('src/handlers/config/GET'),
      layers: props?.layers || [],
      environment: props?.environment || {},
      description: `Handles configuration get requests for the api: ${this.api?.restApiName}`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    this.configResource = this.api.root.addResource('config');

    this.configResource.addMethod('GET', new apigateway.LambdaIntegration(this.configGetFunction), {});

    this.grantBasicRefDataTableRead(this.configGetFunction);

  }
}

module.exports = {
  AdminConfigLambdas,
};