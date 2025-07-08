 /* CDK resources for the config API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");


function bcscSetup(scope, props) {
  console.log('CBCSC handlers setup...')

  const bcscResource = props.api.root.addResource('bcsc');

  // GET /bcsc
  const bcscGetFunction = new NodejsFunction(scope, 'bcscGet', {
    code: lambda.Code.fromAsset('lib/handlers/bcsc/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  const bcscPostFunction = new NodejsFunction(scope, 'bcscPost', {
    code: lambda.Code.fromAsset('lib/handlers/bcsc/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  bcscResource.addMethod('GET', new apigateway.LambdaIntegration(bcscGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });
  
  const userinfoResource = bcscResource.addResource('userinfo');
  const userinfoEnvResource = userinfoResource.addResource('{env}');
  
  userinfoEnvResource.addMethod('GET', new apigateway.LambdaIntegration(bcscGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });
  
  bcscResource.addMethod('POST', new apigateway.LambdaIntegration(bcscPostFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });
  
  const jwksResource = bcscResource.addResource('jwks.json');
  jwksResource.addMethod('GET', new apigateway.LambdaIntegration(bcscGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });

  return {
    bcscGetFunction: bcscGetFunction,
    bcscResource: bcscResource
  };

}


module.exports = {
  bcscSetup
};