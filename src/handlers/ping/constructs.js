const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const { Construct } = require('constructs');

class PingApiConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    const api = props?.api;

    if (!api) {
      throw new Error('PingApiConstruct: Missing required property "api" in props');
    }

    this.testLambdaFunction = new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/handlers/ping'),
      layers: props?.layers || [],
      environment: props?.environment || {},
      description: `Pings the api: ${props?.environment?.API_NAME} to ensure it is working`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    this.pingResource = api.root.addResource('ping');

    this.pingResource.addMethod('GET', new apigateway.LambdaIntegration(this.testLambdaFunction));
  }
}

module.exports = {
  PingApiConstruct,
};