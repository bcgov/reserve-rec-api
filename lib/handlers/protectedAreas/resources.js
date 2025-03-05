/**
 * CDK resources for the protected areas API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function protectedAreasSetup(scope, props) {
  console.log('Protected Areas handlers setup...')

  // /protected-area resource
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

  // PUT /protected-areas/
  const protectedAreasPutFunction = new NodejsFunction(scope, 'ProtectedAreasPut', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  protectedAreasResource.addMethod('PUT', new apigateway.LambdaIntegration(protectedAreasPutFunction));

  // {orcs} identifier
  const protectedAreasResourceByOrcs = protectedAreasResource.addResource('{orcs}')

  // GET /protected-areas/{orcs}
  const protectedAreasGetByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasGetByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas/_orcs/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  protectedAreasResourceByOrcs.addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetByOrcsFunction));

  // PUT /protected-areas/{orcs}
  const protectedAreasPutByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasPutByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas/_orcs/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  protectedAreasResourceByOrcs.addMethod('PUT', new apigateway.LambdaIntegration(protectedAreasPutByOrcsFunction));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:BatchWrite*',
      'dynamodb:PutItem',
    ],
    resources: [props.mainTable.tableArn],
  });

  protectedAreasGetFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasPutFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasGetByOrcsFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasPutByOrcsFunction.addToRolePolicy(dynamoDbPolicy);

  return {
    protectedAreasGetFunction: protectedAreasGetFunction,
    protectedAreasPutFunction: protectedAreasPutFunction,
    protectedAreasGetByOrcsFunction: protectedAreasGetByOrcsFunction,
    protectedAreasPutByOrcsFunction: protectedAreasPutByOrcsFunction,
    protectedAreasResource: protectedAreasResource
  };
}

module.exports = {
  protectedAreasSetup
};
