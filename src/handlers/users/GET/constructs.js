const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");


function createUserFunctions(scope, id, props) {
    const api = props?.api;
  if (!api) {
    throw new Error('UserFunctions: Missing required property "api" in props');
  }

  // Users resource
  const usersResource = api.root.addResource('users');

  // UserpoolId resource
  const userPoolIdResource = usersResource.addResource('{userPoolId}');

  // Sub resource
  const userSubResource = userPoolIdResource.addResource('{sub}');

  // GET /users
  const getUsersFunction = new lambda.Function(scope, `${id}GetUsersFunction`, {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset('src/handlers/users/GET'),
    layers: props?.layers || [],
    environment: props?.environment || {},
  });

}