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

  // GET /activities/{acCollectionId}
  const activitiesGetByAcCollectionId = new NodejsFunction(scope, 'ActivitiesGetByAcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_acCollectionId/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(activitiesGetByAcCollectionId));

  // POST /activities/{acCollectionId}
  const activitiesPostByAcCollectionId = new NodejsFunction(scope, 'ActivitiesPostByAcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_acCollectionId/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(activitiesPostByAcCollectionId));

  // PUT /activities/{acCollectionId}
  const activitiesPutByAcCollectionId = new NodejsFunction(scope, 'ActivitiesPutByAcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_acCollectionId/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('PUT', new apigateway.LambdaIntegration(activitiesPutByAcCollectionId));

  // DELETE /activities/{acCollectionId}
  const activitiesDeleteByAcCollectionId = new NodejsFunction(scope, 'ActivitiesDeleteByAcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_acCollectionId/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesCollectionIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(activitiesDeleteByAcCollectionId));

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
  activitiesPutByAcCollectionId.addToRolePolicy(dynamoDbPolicy);
  activitiesDeleteByAcCollectionId.addToRolePolicy(dynamoDbPolicy);

  return {
    activitiesGetByAcCollectionId: activitiesGetByAcCollectionId,
    activitiesPostByAcCollectionId: activitiesPostByAcCollectionId,
    activitiesPutByAcCollectionId: activitiesPutByAcCollectionId,
    activitiesDeleteByAcCollectionId: activitiesDeleteByAcCollectionId,
    activitiesResource: activitiesResource,
    activitiesCollectionIdResource: activitiesCollectionIdResource,
  };
}

module.exports = {
  activitiesSetup
};
