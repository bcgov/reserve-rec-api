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
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: 'GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResource.addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetFunction));

  // POST /protected-areas/
  const protectedAreasPostFunction = new NodejsFunction(scope, 'ProtectedAreasPost', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: 'POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResource.addMethod('POST', new apigateway.LambdaIntegration(protectedAreasPostFunction));
  
  // DELETE /protected-areas/
  const protectedAreasDeleteFunction = new NodejsFunction(scope, 'ProtectedAreasDelete', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: 'DELETE/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResource.addMethod('DELETE', new apigateway.LambdaIntegration(protectedAreasDeleteFunction));

  // {orcs} identifier
  const protectedAreasResourceByOrcs = protectedAreasResource.addResource('{orcs}')

  // GET /protected-areas/{orcs}
  const protectedAreasGetByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasGetByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: '_orcs/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResourceByOrcs.addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetByOrcsFunction));

  // POST /protected-areas/{orcs}
  const protectedAreasPostByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasPostByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: '_orcs/POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResourceByOrcs.addMethod('POST', new apigateway.LambdaIntegration(protectedAreasPostByOrcsFunction));

  // PUT /protected-areas/{orcs}
  const protectedAreasPutByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasPutByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: '_orcs/PUT/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResourceByOrcs.addMethod('PUT', new apigateway.LambdaIntegration(protectedAreasPutByOrcsFunction));
  
  // DELETE /protected-areas/{orcs}
  const protectedAreasDeleteByOrcsFunction = new NodejsFunction(scope, 'ProtectedAreasDeleteByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/protectedAreas'),
    handler: '_orcs/DELETE/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  protectedAreasResourceByOrcs.addMethod('DELETE', new apigateway.LambdaIntegration(protectedAreasDeleteByOrcsFunction));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:BatchWrite*',
      'dynamodb:PutItem',
      'dynamodb:Delete*'
    ],
    resources: [props.mainTable.tableArn],
  });

  protectedAreasGetFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasPostFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasDeleteFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasGetByOrcsFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasPostByOrcsFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasPutByOrcsFunction.addToRolePolicy(dynamoDbPolicy);
  protectedAreasDeleteByOrcsFunction.addToRolePolicy(dynamoDbPolicy);

  return {
    protectedAreasGetFunction: protectedAreasGetFunction,
    protectedAreasPostFunction: protectedAreasPostFunction,
    protectedAreasDeleteFunction: protectedAreasDeleteFunction,
    protectedAreasGetByOrcsFunction: protectedAreasGetByOrcsFunction,
    protectedAreasPostByOrcsFunction: protectedAreasPostByOrcsFunction,
    protectedAreasPutByOrcsFunction: protectedAreasPutByOrcsFunction,
    protectedAreasDeleteByOrcsFunction: protectedAreasDeleteByOrcsFunction,
    protectedAreasResource: protectedAreasResource
  };
}

module.exports = {
  protectedAreasSetup
};
