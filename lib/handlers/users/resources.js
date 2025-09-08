/**
 * CDK resources for the User API
 */

const lambda = require('aws-cdk-lib/aws-lambda');
const ssm = require('aws-cdk-lib/aws-ssm');
const cognito = require('aws-cdk-lib/aws-cognito');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Fn } = require('aws-cdk-lib');

async function userSetup(scope, props) {
  console.log('User handler setup...');

  // Attempt to get user pools from SSM Parameters.
  // If they don't exist, fall back to props.
  // This allows for potential overrides if needed.

  let publicUserPoolId = await ssm.StringParameter.valueForStringParameter(scope, 'publicUserPoolId').catch(() => null);
  let adminUserPoolId = await ssm.StringParameter.valueForStringParameter(scope, 'adminUserPoolId').catch(() => null);

  let importedPublicUserPool = cognito.UserPool.fromUserPoolId(scope, 'ImportedPublicUserPool', publicUserPoolId);
  let importedAdminUserPool = cognito.UserPool.fromUserPoolId(scope, 'ImportedAdminUserPool', adminUserPoolId);

  const publicUserPool = importedPublicUserPool ? importedPublicUserPool : props.publicUserPool;
  const adminUserPool = importedAdminUserPool ? importedAdminUserPool : props.adminUserPool;

  const userResource = props.api.root.addResource('users');
  const userPoolIdResource = userResource.addResource('{userPoolId}');
  const userSubResource = userPoolIdResource.addResource('{sub}');

  // GET /users
  const usersGetFunction = new NodejsFunction(scope, 'UsersGet', {
    code: lambda.Code.fromAsset('lib/handlers/users/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  userPoolIdResource.addMethod(
    "GET",
    new apigateway.LambdaIntegration(usersGetFunction),
    {
      authorizer: props.adminRequestAuthorizer,
    }
  );
  userSubResource.addMethod(
    "GET",
    new apigateway.LambdaIntegration(usersGetFunction),
    {
      authorizer: props.adminRequestAuthorizer,
    }
  );

  // Add DynamoDB policy to the function
  const cognitoIDPPolicy = new iam.PolicyStatement({
    resources: [publicUserPool.userPoolArn, adminUserPool.userPoolArn],
    actions: [
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminConfirmSignUp',
      'cognito-idp:AdminSetUserPassword',
      'cognito-idp:ListUsers',
    ],
  });

  usersGetFunction.addToRolePolicy(cognitoIDPPolicy);

  return {
    usersGetFunction: usersGetFunction,
    userResource: userResource
  };
}

module.exports = {
  userSetup
};
