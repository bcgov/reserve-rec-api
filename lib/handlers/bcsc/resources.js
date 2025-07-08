 /* CDK resources for the config API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");


function bcscSetup(scope, props) {
  console.log('CBCSC handlers setup...')

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
    bcscGetFunction: bcscGetFunction,
    bcscResource: bcscResource
  };

}


module.exports = {
  bcscSetup
};