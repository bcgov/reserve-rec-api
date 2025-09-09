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

  // /geozones/{collectionId}/ resource
  const geozonesCollectionIdResource = geozonesResource.addResource('{collectionId}');
  // /geozones/{collectionId}/{geozoneId} resource
  const geozonesGeozoneIdResource = geozonesCollectionIdResource.addResource('{geozoneId}');

  // GET /geozones/{collectionId}
  const geozonesGetByCollectionId = new NodejsFunction(scope, 'GeozonesGetByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_collectionId/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  geozonesCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByCollectionId));
    // GET /geozones/{collectionId}/{geozoneId}
  geozonesGeozoneIdResource.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByCollectionId));

  // POST /geozones/{collectionId}
  const geozonesPostByCollectionId = new NodejsFunction(scope, 'GeozonesPostByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_collectionId/POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(geozonesPostByCollectionId));

  // PUT /geozones/{collectionId}
  const geozonesPutByCollectionId = new NodejsFunction(scope, 'GeozonesPutByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_collectionId/PUT/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionIdResource.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByCollectionId));
      // GET /geozones/{collectionId}/{geozoneId}
  geozonesGeozoneIdResource.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByCollectionId));

  // DELETE /geozones/{collectionId}
  const geozonesDeleteByGeozoneId = new NodejsFunction(scope, 'GeozonesDeleteByGeozoneId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones'),
    handler: '_collectionId/DELETE/index.handler',
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

  geozonesGetByCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesPostByCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesPutByCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesDeleteByGeozoneId.addToRolePolicy(dynamoDbPolicy);

  return {
    geozonesGetByCollectionId: geozonesGetByCollectionId,
    geozonesPostByCollectionId: geozonesPostByCollectionId,
    geozonesPutByCollectionId: geozonesPutByCollectionId,
    geozonesDeleteByGeozoneId: geozonesDeleteByGeozoneId,
    geozonesResource: geozonesResource
  };
}

module.exports = {
  geozonesSetup
};
