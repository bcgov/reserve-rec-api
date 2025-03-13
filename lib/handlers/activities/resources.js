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

  // /activities/{orcs}/ resource
  const activitiesOrcsResource = activitiesResource.addResource('{orcs}');

  // GET /activities/{orcs}
  const activitiesGetByOrcs = new NodejsFunction(scope, 'ActivitiesGetByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_orcs/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesOrcsResource.addMethod('GET', new apigateway.LambdaIntegration(activitiesGetByOrcs));
  
  // POST /activities/{orcs}
  const activitiesPostByOrcs = new NodejsFunction(scope, 'ActivitiesPostByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_orcs/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesOrcsResource.addMethod('POST', new apigateway.LambdaIntegration(activitiesPostByOrcs));
  
  // PUT /activities/{orcs}
  const activitiesPutByOrcs = new NodejsFunction(scope, 'ActivitiesPutByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_orcs/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesOrcsResource.addMethod('PUT', new apigateway.LambdaIntegration(activitiesPutByOrcs));
  
  // DELETE /activities/{orcs}
  const activitiesDeleteByOrcs = new NodejsFunction(scope, 'ActivitiesDeleteByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/activities/_orcs/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  activitiesOrcsResource.addMethod('DELETE', new apigateway.LambdaIntegration(activitiesDeleteByOrcs));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:BatchWrite*',
      'dynamodb:PutItem',
      'dynamodb:Delete*',
    ],
    resources: [props.mainTable.tableArn],
  });

  activitiesGetByOrcs.addToRolePolicy(dynamoDbPolicy);
  activitiesPostByOrcs.addToRolePolicy(dynamoDbPolicy);
  activitiesPutByOrcs.addToRolePolicy(dynamoDbPolicy);
  activitiesDeleteByOrcs.addToRolePolicy(dynamoDbPolicy);

  return {
    activitiesGetByOrcs: activitiesGetByOrcs,
    activitiesPostByOrcs: activitiesPostByOrcs,
    activitiesPutByOrcs: activitiesPutByOrcs,
    activitiesDeleteByOrcs: activitiesDeleteByOrcs,
    activitiesResource: activitiesResource
  };
}

module.exports = {
  activitiesSetup
};
