/**
 * CDK resources for the geozones API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function geozonesSetup(scope, props) {
  console.log('geozones handlers setup...')

  // /geozones resource
  const geozonesResource = props.api.root.addResource('geozones');

  // /geozones/{gzCollectionId}/ resource
  const geozonesGzCollectionIdResource = geozonesResource.addResource('{gzCollectionId}');
  // /geozones/{gzCollectionId}/{geozoneId} resource
  const geozonesGeozoneIdResource = geozonesGzCollectionIdResource.addResource('{geozoneId}');

  // GET /geozones/{gzCollectionId}
  const geozonesGetByGzCollectionId = new NodejsFunction(scope, 'GeozonesGetByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  geozonesGzCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByGzCollectionId));
    // GET /geozones/{gzCollectionId}/{geozoneId}
  geozonesGeozoneIdResource.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByGzCollectionId));

  // POST /geozones/{gzCollectionId}
  const geozonesPostByGzCollectionId = new NodejsFunction(scope, 'GeozonesPostByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesGzCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(geozonesPostByGzCollectionId));

  // PUT /geozones/{gzCollectionId}
  const geozonesPutByGzCollectionId = new NodejsFunction(scope, 'GeozonesPutByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesGzCollectionIdResource.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByGzCollectionId));
      // GET /geozones/{gzCollectionId}/{geozoneId}
  geozonesGeozoneIdResource.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByGzCollectionId));

  // DELETE /geozones/{gzCollectionId}
  const geozonesDeleteByGzCollectionId = new NodejsFunction(scope, 'GeozonesDeleteByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesGzCollectionIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(geozonesDeleteByGzCollectionId));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:BatchWrite*',
      'dynamodb:PutItem',
      'dynamodb:Delete*',
      'dynamodb:Update*'
    ],
    resources: [props.mainTable.tableArn],
  });

  geozonesGetByGzCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesPostByGzCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesPutByGzCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesDeleteByGzCollectionId.addToRolePolicy(dynamoDbPolicy);

  return {
    geozonesGetByGzCollectionId: geozonesGetByGzCollectionId,
    geozonesPostByGzCollectionId: geozonesPostByGzCollectionId,
    geozonesPutByGzCollectionId: geozonesPutByGzCollectionId,
    geozonesDeleteByGzCollectionId: geozonesDeleteByGzCollectionId,
    geozonesResource: geozonesResource
  };
}

module.exports = {
  geozonesSetup
};
