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

  // /facilities/{collectionId}/ resource
  const collectionIdResource = facilitiesResource.addResource('{collectionId}');
  // /facilities/{collectionId}/{facilityType} resource
  const facilityTypeResource = collectionIdResource.addResource('{facilityType}');
  // /facilities/{collectionId}/{facilityType}/{facilityId} resource
  const facilityIdResource = facilityTypeResource.addResource('{facilityId}');

  // GET /facilities/{collectionId}
  const facilitiesGetByCollectionId = new NodejsFunction(scope, 'FacilitiesGetByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities'),
    handler: '_collectionId/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  collectionIdResource.addMethod('GET', new apigateway.LambdaIntegration(facilitiesGetByCollectionId));
  facilityTypeResource.addMethod('GET', new apigateway.LambdaIntegration(facilitiesGetByCollectionId));
  facilityIdResource.addMethod('GET', new apigateway.LambdaIntegration(facilitiesGetByCollectionId));

  // POST /facilities/{collectionId}
  const facilitiesPostByCollectionId = new NodejsFunction(scope, 'FacilitiesPostByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities'),
    handler: '_collectionId/POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  collectionIdResource.addMethod('POST', new apigateway.LambdaIntegration(facilitiesPostByCollectionId));
  facilityTypeResource.addMethod('POST', new apigateway.LambdaIntegration(facilitiesPostByCollectionId));

  // PUT /facilities/{collectionId}
  const facilitiesPutByCollectionId = new NodejsFunction(scope, 'FacilitiesPutByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities'),
    handler: '_collectionId/PUT/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  collectionIdResource.addMethod('PUT', new apigateway.LambdaIntegration(facilitiesPutByCollectionId));
  facilityTypeResource.addMethod('PUT', new apigateway.LambdaIntegration(facilitiesPutByCollectionId));
  facilityIdResource.addMethod('PUT', new apigateway.LambdaIntegration(facilitiesPutByCollectionId));

  // DELETE /facilities/{collectionId}
  const facilitiesDeleteByCollectionId = new NodejsFunction(scope, 'FacilitiesDeleteByCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/facilities'),
    handler: '_collectionId/DELETE/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  collectionIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(facilitiesDeleteByCollectionId));
  facilityTypeResource.addMethod('DELETE', new apigateway.LambdaIntegration(facilitiesDeleteByCollectionId));
  facilityIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(facilitiesDeleteByCollectionId));

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

  facilitiesGetByCollectionId.addToRolePolicy(dynamoDbPolicy);
  facilitiesPostByCollectionId.addToRolePolicy(dynamoDbPolicy);
  facilitiesPutByCollectionId.addToRolePolicy(dynamoDbPolicy);
  facilitiesDeleteByCollectionId.addToRolePolicy(dynamoDbPolicy);

  return {
    facilitiesGetByCollectionId: facilitiesGetByCollectionId,
    facilitiesPostByCollectionId: facilitiesPostByCollectionId,
    facilitiesPutByCollectionId: facilitiesPutByCollectionId,
    facilitiesDeleteByCollectionId: facilitiesDeleteByCollectionId,
    facilitiesResource: facilitiesResource
  };
}

module.exports = {
  facilitiesSetup
};
