/**
 * CDK resources for the User API
 */

const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function userSetup(scope, props) {
  console.log('User handler setup...');

  let adminUserPoolArn = props.adminUserPool.userPoolArn;
  let publicUserPoolArn = props.publicUserPool.userPoolArn;

  // Dev pools were created manually. Will need to employ a Pool Manager Stack
  if (props.env.ENVIRONMENT_NAME === 'dev') {
    adminUserPoolArn = 'arn:aws:cognito-idp:ca-central-1:637423314715:userpool/ca-central-1_PNSP3t9gn'
    publicUserPoolArn = 'arn:aws:cognito-idp:ca-central-1:637423314715:userpool/ca-central-1_hWfrVEhHa'
  }

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

  // Add Cognito policy to the function
  // TODO: Limit to specific pools
  const cognitoIDPPolicy = new iam.PolicyStatement({
    resources: [adminUserPoolArn, publicUserPoolArn],
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
