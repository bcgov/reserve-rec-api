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

  // /facilities/{orcs}/ resource
  const facilitiesOrcsResource = facilitiesResource.addResource('{orcs}');

  // GET /facilities/{orcs}
  const facilitiesGetByOrcs = new NodejsFunction(scope, 'FacilitiesGetByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_orcs/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  facilitiesOrcsResource.addMethod('GET', new apigateway.LambdaIntegration(facilitiesGetByOrcs));
  
  // POST /facilities/{orcs}
  const facilitiesPostByOrcs = new NodejsFunction(scope, 'FacilitiesPostByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_orcs/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  facilitiesOrcsResource.addMethod('POST', new apigateway.LambdaIntegration(facilitiesPostByOrcs));
  
  // PUT /facilities/{orcs}
  const facilitiesPutByOrcs = new NodejsFunction(scope, 'FacilitiesPutByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_orcs/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  facilitiesOrcsResource.addMethod('PUT', new apigateway.LambdaIntegration(facilitiesPutByOrcs));
  
  // DELETE /facilities/{orcs}
  const facilitiesDeleteByOrcs = new NodejsFunction(scope, 'FacilitiesDeleteByOrcs', {
    code: lambda.Code.fromAsset('lib/handlers/facilities/_orcs/DELETE'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  facilitiesOrcsResource.addMethod('DELETE', new apigateway.LambdaIntegration(facilitiesDeleteByOrcs));

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

  facilitiesGetByOrcs.addToRolePolicy(dynamoDbPolicy);
  facilitiesPostByOrcs.addToRolePolicy(dynamoDbPolicy);
  facilitiesPutByOrcs.addToRolePolicy(dynamoDbPolicy);
  facilitiesDeleteByOrcs.addToRolePolicy(dynamoDbPolicy);

  return {
    facilitiesGetByOrcs: facilitiesGetByOrcs,
    facilitiesPostByOrcs: facilitiesPostByOrcs,
    facilitiesPutByOrcs: facilitiesPutByOrcs,
    facilitiesDeleteByOrcs: facilitiesDeleteByOrcs,
    facilitiesResource: facilitiesResource
  };
}

module.exports = {
  facilitiesSetup
};
