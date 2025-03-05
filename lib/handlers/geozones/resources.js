/**
 * CDK resources for the geozones API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function geozonesSetup(scope, props) {
  console.log('Geozones handlers setup...')

  // /geozones resource
  const geozonesResource = props.api.root.addResource('geozones');

  // /geozones/{gzcollection}/{gzcollectionid} resource
  const collectionResource = geozonesResource.addResource('{gzcollection}');
  const geozonesCollectionId = collectionResource.addResource('{gzcollectionid}');
  
  // GET /geozones/{gzcollection}/{gzcollectionid}
  const geozonesGetByGzCollectionId = new NodejsFunction(scope, 'GeozonesGetByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionId.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByGzCollectionId));
  
  // POST /geozones/{gzcollection}/{gzcollectionid}
  const geozonesPostByGzCollectionId = new NodejsFunction(scope, 'GeozonesPostByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionId.addMethod('POST', new apigateway.LambdaIntegration(geozonesPostByGzCollectionId));
  
  // PUT /geozones/{gzcollection}/{gzcollectionid}
  const geozonesPutByGzCollectionId = new NodejsFunction(scope, 'GeozonesPutByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionId.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByGzCollectionId));
  
  // DELETE /geozones/{gzcollection}/{gzcollectionid}
  const geozonesDeleteByGzCollectionId = new NodejsFunction(scope, 'GeozonesDeleteByGzCollectionId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionId.addMethod('DELETE', new apigateway.LambdaIntegration(geozonesDeleteByGzCollectionId));
  
  // /geozones/{gzcollection}/{gzcollectionid}/{geozoneid} resource
  const geozonesCollectionGeozoneId = geozonesCollectionId.addResource('{geozoneid}');

  // GET /geozones/{gzcollection}/{gzcollectionid}/{geozoneid}
  const geozonesGetByGzCollectionGeozoneId = new NodejsFunction(scope, 'GeozonesGetByGzCollectionGeozoneId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/_geozoneid/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionGeozoneId.addMethod('GET', new apigateway.LambdaIntegration(geozonesGetByGzCollectionGeozoneId));

  // POST /geozones/{gzcollection}/{gzcollectionid}/{geozoneid}
  const geozonesPostByGzCollectionGeozoneId = new NodejsFunction(scope, 'GeozonesPostByGzCollectionGeozoneId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/_geozoneid/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionGeozoneId.addMethod('POST', new apigateway.LambdaIntegration(geozonesPostByGzCollectionGeozoneId));
  
  // PUT /geozones/{gzcollection}/{gzcollectionid}/{geozoneid}
  const geozonesPutByGzCollectionGeozoneId = new NodejsFunction(scope, 'GeozonesPutByGzCollectionGeozoneId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/_geozoneid/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionGeozoneId.addMethod('PUT', new apigateway.LambdaIntegration(geozonesPutByGzCollectionGeozoneId));
  
  // DELETE /geozones/{gzcollection}/{gzcollectionid}/{geozoneid}
  const geozonesDeleteByGzCollectionGeozoneId = new NodejsFunction(scope, 'GeozonesDeleteByGzCollectionGeozoneId', {
    code: lambda.Code.fromAsset('lib/handlers/geozones/_gzCollectionId/_geozoneid/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  geozonesCollectionGeozoneId.addMethod('DELETE', new apigateway.LambdaIntegration(geozonesDeleteByGzCollectionGeozoneId));

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

  geozonesGetByGzCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesPostByGzCollectionId.addToRolePolicy(dynamoDbPolicy);
  geozonesGetByGzCollectionGeozoneId.addToRolePolicy(dynamoDbPolicy);
  geozonesPostByGzCollectionGeozoneId.addToRolePolicy(dynamoDbPolicy);
  geozonesPutByGzCollectionGeozoneId.addToRolePolicy(dynamoDbPolicy);
  geozonesDeleteByGzCollectionGeozoneId.addToRolePolicy(dynamoDbPolicy);

  return {
    geozonesGetByGzCollectionId: geozonesGetByGzCollectionId,
    geozonesPostByGzCollectionId: geozonesPostByGzCollectionId,
    geozonesGetByGzCollectionGeozoneId: geozonesGetByGzCollectionGeozoneId,
    geozonesPostByGzCollectionGeozoneId: geozonesPostByGzCollectionGeozoneId,
    geozonesPutByGzCollectionGeozoneId: geozonesPutByGzCollectionGeozoneId,
    geozonesDeleteByGzCollectionGeozoneId: geozonesDeleteByGzCollectionGeozoneId,
    geozonesResource: geozonesResource
  };
}

module.exports = {
  geozonesSetup
};
