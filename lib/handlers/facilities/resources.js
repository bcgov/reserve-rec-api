/**
 * CDK resources for the facilities API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function facilitiesSetup(scope, props) {
  console.log('Facilities handlers setup...')

  // /facilities resource
  const facilitiesResource = props.api.root.addResource('facilities');

  // /facilities/{fcCollectionId}/ resource
  const fcCollectionIdResource = facilitiesResource.addResource('{fcCollectionId}');

  // GET /facilities/{fcCollectionId}
  const facilitiesGetByFcCollectionId = new NodejsFunction(scope, 'FacilitiesGetByFcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_fcCollectionId/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  fcCollectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(facilitiesGetByFcCollectionId));

  // POST /facilities/{fcCollectionId}
  const facilitiesPostByFcCollectionId = new NodejsFunction(scope, 'FacilitiesPostByFcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_fcCollectionId/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  fcCollectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(facilitiesPostByFcCollectionId));

  // PUT /facilities/{fcCollectionId}
  const facilitiesPutByFcCollectionId = new NodejsFunction(scope, 'FacilitiesPutByFcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_fcCollectionId/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  fcCollectionIdResource.addMethod('PUT', new apigateway.LambdaIntegration(facilitiesPutByFcCollectionId));

  // DELETE /facilities/{fcCollectionId}
  const facilitiesDeleteByFcCollectionId = new NodejsFunction(scope, 'FacilitiesDeleteByFcCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_fcCollectionId/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  fcCollectionIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(facilitiesDeleteByFcCollectionId));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:BatchWrite*',
      'dynamodb:PutItem',
      'dynamodb:Delete*',
      'dynamodb:Update*',
      'dynamodb:BatchGetItem',
    ],
    resources: [props.mainTable.tableArn],
  });

  facilitiesGetByFcCollectionId.addToRolePolicy(dynamoDbPolicy);
  facilitiesPostByFcCollectionId.addToRolePolicy(dynamoDbPolicy);
  facilitiesPutByFcCollectionId.addToRolePolicy(dynamoDbPolicy);
  facilitiesDeleteByFcCollectionId.addToRolePolicy(dynamoDbPolicy);

  return {
    facilitiesGetByFcCollectionId: facilitiesGetByFcCollectionId,
    facilitiesPostByFcCollectionId: facilitiesPostByFcCollectionId,
    facilitiesPutByFcCollectionId: facilitiesPutByFcCollectionId,
    facilitiesDeleteByFcCollectionId: facilitiesDeleteByFcCollectionId,
    facilitiesResource: facilitiesResource
  };
}

module.exports = {
  facilitiesSetup
};
