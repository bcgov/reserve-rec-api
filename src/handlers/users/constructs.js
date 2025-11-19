const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');

const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");

const defaults = {
  resources: {
    getUsersFunction: {
      name: 'GetUsersFunction',
    }
  }
};

class UsersConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // Add /users resource
    this.usersResource = this.resolveApi().root.addResource('users');

    // Add /Userpool identifier resource
    this.userPoolIdResource = this.usersResource.addResource('{userPoolId}');

    // Sub resource
    this.userSubResource = this.userPoolIdResource.addResource('{sub}');

    // Users GET by UserPool ID and Sub Lambda Function

    // GET /users
    this.getUsersFunction = this.generateBasicLambdaFn(
      scope,
      'getUsersFunction',
      'src/handlers/users/GET',
      'index.handler',
      {
        basicRead: true,
      }
    );

    // GET /users/{userPoolId}
    this.userPoolIdResource.addMethod('GET', new apigateway.LambdaIntegration(this.getUsersFunction), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /users/{userPoolId}/{sub}
    this.userSubResource.addMethod('GET', new apigateway.LambdaIntegration(this.getUsersFunction), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions for Lambda to read from Cognito User Pools
    this.getUsersFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"], // Consider restricting this to specific user pool ARNs if possible
    }));

  }
}

module.exports = {
  UsersConstruct,
};