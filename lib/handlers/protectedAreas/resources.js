/**
 * CDK resources for the protected areas API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function protectedAreasSetup(scope, props) {
  console.log('Protected Areas handlers setup...')

  const protectedAreasResource = props.api.root.addResource('protected-areas');

  // GET /protected-areas
  const protectedAreasGetFunction = new NodejsFunction(scope, 'ProtectedAreasGet', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  protectedAreasResource.addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetFunction));

  // GET /protected-areas/orcs
  const protectedAreasGetByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasGetByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas/_orcs/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  protectedAreasResource.addResource('{orcs}').addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetByOrcsFunction));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem'
    ],
    resources: [props.mainTable.tableArn],
  });

  protectedAreasGetFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasGetByOrcsFunction.addToRolePolicy(dynamoDbPolicy);

  return {
    protectedAreasGetFunction: protectedAreasGetFunction,
    protectedAreasGetByOrcsFunction: protectedAreasGetByOrcsFunction,
    protectedAreasResource: protectedAreasResource
  };
}

module.exports = {
  protectedAreasSetup
};