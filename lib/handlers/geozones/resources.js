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
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_gzCollectionId/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  geozonesGzCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByGzCollectionId));
    // GET /geozones/{gzCollectionId}/{geozoneId}
  geozonesGeozoneIdResource.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByGzCollectionId));

  // POST /geozones/{gzCollectionId}
  const geozonesPostByGzCollectionId = new NodejsFunction(scope, 'GeozonesPostByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_gzCollectionId/POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesGzCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(geozonesPostByGzCollectionId));

  // PUT /geozones/{gzCollectionId}
  const geozonesPutByGzCollectionId = new NodejsFunction(scope, 'GeozonesPutByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_gzCollectionId/PUT/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesGzCollectionIdResource.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByGzCollectionId));
      // GET /geozones/{gzCollectionId}/{geozoneId}
  geozonesGeozoneIdResource.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByGzCollectionId));

  // DELETE /geozones/{gzCollectionId}
  const geozonesDeleteByGeozoneId = new NodejsFunction(scope, 'GeozonesDeleteByGeozoneId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_gzCollectionId/DELETE/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesGeozoneIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(geozonesDeleteByGeozoneId));

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
  geozonesDeleteByGeozoneId.addToRolePolicy(dynamoDbPolicy);

  return {
    geozonesGetByGzCollectionId: geozonesGetByGzCollectionId,
    geozonesPostByGzCollectionId: geozonesPostByGzCollectionId,
    geozonesPutByGzCollectionId: geozonesPutByGzCollectionId,
    geozonesDeleteByGeozoneId: geozonesDeleteByGeozoneId,
    geozonesResource: geozonesResource
  };
}

module.exports = {
  geozonesSetup
};
