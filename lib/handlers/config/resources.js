/**
 * CDK resources for the config API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");


function configSetup(scope, props) {
  console.log('Config handlers setup...')

  const configResource = props.api.root.addResource('config');

  // GET /config
  const configGetFunction = new NodejsFunction(scope, 'ConfigGet', {
    code: lambda.Code.fromAsset('lib/handlers/config/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  configResource.addMethod('GET', new apigateway.LambdaIntegration(configGetFunction), {
    authorizationType: apigateway.AuthorizationType.NONE,
  });

  // Add DynamoDB query policy to the function
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: ['dynamodb:GetItem'],
    resources: [props.mainTable.tableArn],
  });

  configGetFunction.addToRolePolicy(dynamoDbPolicy);

  return {
    configGetFunction: configGetFunction,
    configResource: configResource
  };

}


module.exports = {
  configSetup
};