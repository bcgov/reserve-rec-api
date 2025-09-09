/**
 * CDK resources for the products API.
 */

const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function productsSetup(scope, props) {
  console.log('products handlers setup...');

  // /products resource
  const productsResource = props.api.root.addResource('products');

  // /products/{collectionId}/{activityType}/{activityId} resource. All belong to the partition so there is no ability to query any of them individually
  const productsPartitionResource = productsResource.addResource('{collectionId}').addResource('{activityType}').addResource('{activityId}');

  // GET /products/{collectionId}/{activityType}/{activityId} - Get all products for a given activity
  const productsGetMethod = new NodejsFunction(scope, 'ProductsGetByPartition', {
    code: lambda.Code.fromAsset('lib/handlers'),
    handler: 'products/_byPartition/GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  productsPartitionResource.addMethod('GET', new apigateway.LambdaIntegration(productsGetMethod));

  // GET /products/{collectionId}/{activityType}/{activityId}/{seasonId} - Get all products for a given activity and season
  const productsSeasonIdResource = productsPartitionResource.addResource('{seasonId}');
  productsSeasonIdResource.addMethod('GET', new apigateway.LambdaIntegration(productsGetMethod));

  // GET /products/{collectionId}/{activityType}/{activityId}/{seasonId}/{productId} - Get a single product by identifier
  const productsProductIdResource = productsSeasonIdResource.addResource('{productId}');
  productsProductIdResource.addMethod('GET', new apigateway.LambdaIntegration(productsGetMethod));

  // Add DynamoDB query & getItem policies to the functions
  const dynamoDbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:Query',
      'dynamodb:GetItem',
      'dynamodb:Scan',
      'dynamodb:BatchGet*'
    ],
    resources: [props.mainTable.tableArn],
  });

  productsGetMethod.addToRolePolicy(dynamoDbPolicy);

  return {
    productsGetMethod: productsGetMethod,
    productsResource: productsResource,
  };
}

module.exports = {
  productsSetup,
};
