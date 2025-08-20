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

  // /activities/{acCollectionId}/ resource
  const activitiesCollectionIdResource = activitiesResource.addResource('{acCollectionId}');
  const activitiesCollectionTypeIdResource = activitiesCollectionIdResource.addResource('{activityType}').addResource('{activityId}');

  // GET /activities/{acCollectionId}
  const activitiesGetByAcCollectionId = new NodejsFunction(scope, 'ActivitiesGetByAcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_acCollectionId/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(activitiesGetByAcCollectionId));

  // POST /activities/{acCollectionId}
  const activitiesPostByAcCollectionId = new NodejsFunction(scope, 'ActivitiesPostByAcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_acCollectionId/POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(activitiesPostByAcCollectionId));

  // PUT /activities/{acCollectionId}/{activityType}/{activityId}
  const activitiesPutByCollectionTypeId = new NodejsFunction(scope, 'ActivitiesPutByCollectionTypeId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_acCollectionId/PUT/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionTypeIdResource.addMethod('PUT', new apigateway.LambdaIntegration(activitiesPutByCollectionTypeId));

  // DELETE /activities/{acCollectionId}/{activityType}/{activityId}
  const activitiesDeleteByCollectionTypeId = new NodejsFunction(scope, 'ActivitiesDeleteByCollectionTypeId', {
    code: lambda.Code.fromAsset('lib/handlers/activities'),
    handler: '_acCollectionId/DELETE/index.handler',
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

  activitiesGetByAcCollectionId.addToRolePolicy(dynamoDbPolicy);
  activitiesPostByAcCollectionId.addToRolePolicy(dynamoDbPolicy);
  activitiesPutByCollectionTypeId.addToRolePolicy(dynamoDbPolicy);
  activitiesDeleteByCollectionTypeId.addToRolePolicy(dynamoDbPolicy);

  return {
    activitiesGetByAcCollectionId: activitiesGetByAcCollectionId,
    activitiesPostByAcCollectionId: activitiesPostByAcCollectionId,
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
