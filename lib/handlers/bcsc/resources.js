 /* CDK resources for the config API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function bcscSetup(scope, props) {
  console.log('CBCSC handlers setup...')

  // Define the Lambda functions first
  const bcscPostFunction = new NodejsFunction(scope, 'BcscPostFunction', {
    code: lambda.Code.fromAsset('lib/handlers/bcsc/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  const bcscGetFunction = new NodejsFunction(scope, 'BcscGetFunction', {
    code: lambda.Code.fromAsset('lib/handlers/bcsc/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  const bcscResource = props.api.root.addResource('bcsc');

  // /bcsc/token/{env} - POST
  const tokenResource = bcscResource.addResource('token');
  const tokenEnvResource = tokenResource.addResource('{env}');
  tokenEnvResource.addMethod('POST', new apigateway.LambdaIntegration(bcscPostFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });

  // /bcsc/userinfo/{env} - GET
  const userinfoResource = bcscResource.addResource('userinfo');
  const userinfoEnvResource = userinfoResource.addResource('{env}');
  userinfoEnvResource.addMethod('GET', new apigateway.LambdaIntegration(bcscGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });

  // /bcsc/jwks.json - GET
  const jwksResource = bcscResource.addResource('jwks.json');
  jwksResource.addMethod('GET', new apigateway.LambdaIntegration(bcscGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });

  bcscResource.addMethod('GET', new apigateway.LambdaIntegration(bcscGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });

  return {
    bcscPostFunction,
    bcscGetFunction,
    bcscResource
  };
}


module.exports = {
  bcscSetup
};