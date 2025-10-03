const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const { Tags } = require('aws-cdk-lib');

function createTestLambda(scope, id, props) {

  const api = props?.api;
  if (!api) {
    throw new Error('TestLambdaConstruct: Missing required property "api" in props');
  }


  // Test resource
  const testResource = api.root.addResource('test');

  // GET /test
  const lambdaFunction = new lambda.Function(scope, id, {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset('src/handlers/events'),
    layers: props?.layers || [],
    environment: props?.environment || {},
  });

  testResource.addMethod('GET', new apigateway.LambdaIntegration(lambdaFunction));

  Tags.of(lambdaFunction).add('lambdaType', 'testLambda');

  return lambdaFunction;
}

module.exports = {
  createTestLambda,
};