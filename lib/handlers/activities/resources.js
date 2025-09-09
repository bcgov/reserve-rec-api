/**
 * CDK resources for the activities API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function activitiesSetup(scope, props) {
  console.log('activities handlers setup...')

  // /activities resource
  const activitiesResource = props.api.root.addResource('activities');

  // /activities/{collectionId}/ resource
  const activitiesCollectionIdResource = activitiesResource.addResource('{collectionId}');
  const activitiesCollectionTypeIdResource = activitiesCollectionIdResource.addResource('{activityType}').addResource('{activityId}');

  // GET /activities/{collectionId}
  const activitiesGetByCollectionId = new NodejsFunction(scope, 'ActivitiesGetByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_collectionId/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(activitiesGetByCollectionId));

  // POST /activities/{collectionId}
  const activitiesPostByCollectionId = new NodejsFunction(scope, 'ActivitiesPostByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_collectionId/POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(activitiesPostByCollectionId));

  // PUT /activities/{collectionId}/{activityType}/{activityId}
  const activitiesPutByCollectionTypeId = new NodejsFunction(scope, 'ActivitiesPutByCollectionTypeId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_collectionId/PUT/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionTypeIdResource.addMethod('PUT', new apigateway.LambdaIntegration(activitiesPutByCollectionTypeId));

  // DELETE /activities/{collectionId}/{activityType}/{activityId}
  const activitiesDeleteByCollectionTypeId = new NodejsFunction(scope, 'ActivitiesDeleteByCollectionTypeId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_collectionId/DELETE/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionTypeIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(activitiesDeleteByCollectionTypeId));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:BatchWrite*',
      'dynamodb:PutItem',
      'dynamodb:Delete*',
      'dynamodb:Update*',
    ],
    resources: [props.mainTable.tableArn],
  });

  activitiesGetByCollectionId.addToRolePolicy(dynamoDbPolicy);
  activitiesPostByCollectionId.addToRolePolicy(dynamoDbPolicy);
  activitiesPutByCollectionTypeId.addToRolePolicy(dynamoDbPolicy);
  activitiesDeleteByCollectionTypeId.addToRolePolicy(dynamoDbPolicy);

  return {
    activitiesGetByCollectionId: activitiesGetByCollectionId,
    activitiesPostByCollectionId: activitiesPostByCollectionId,
    activitiesPutByCollectionTypeId: activitiesPutByCollectionTypeId,
    activitiesDeleteByCollectionTypeId: activitiesDeleteByCollectionTypeId,
    activitiesResource: activitiesResource,
    activitiesCollectionIdResource: activitiesCollectionIdResource,
    activitiesCollectionTypeIdResource: activitiesCollectionTypeIdResource
  };
}

module.exports = {
  activitiesSetup
};
