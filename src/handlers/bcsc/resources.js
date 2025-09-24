 /* CDK resources for the config API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const cdk = require('aws-cdk-lib');
function bcscSetup(scope, props) {
  console.log('BCSC handlers setup...');

  // Define the Lambda functions first
  const bcscGetFunction = new NodejsFunction(scope, 'BcscGetFunction', {
    code: lambda.Code.fromAsset('lib/handlers/bcsc/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    layers: props.layers,
    timeout: cdk.Duration.minutes(3), // Add timeout - increasing for decryption
    memorySize: 768, // Also consider increasing memory for RSA key generation
    environment: {
      ...props.env,
      BCSC_KEY_ID: props.env.BCSC_KEY_ID,
      JWT_KEY_ID: props.env.JWT_KEY_ID, 
    }
  });

  bcscGetFunction.addToRolePolicy(new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'kms:Decrypt',
      'kms:GetPublicKey'
    ],
    resources: [`arn:aws:kms:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:key/*`]
  }));

  const bcscPostFunction = new NodejsFunction(scope, 'BcscPostFunction', {
    code: lambda.Code.fromAsset('lib/handlers/bcsc/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    timeout: cdk.Duration.minutes(2), // Add timeout for POST as well
    memorySize: 768, // Increase memory
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
  const jwksResource = bcscResource.addResource('jwks');
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