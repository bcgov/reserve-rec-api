const apigw = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NestedStack, CfnOutput } = require('aws-cdk-lib');
const { Duration } = require('aws-cdk-lib');
const { AdminAuthorizerConstruct } = require("../../../src/handlers/authorizers/constructs");

const now = new Date().toISOString();

/**
 *  NestedStack for core Admin API resources - API Gateway, Authorizer,
 *  and shared outputs.
 *
 *  The RestApi and the Authorizer must exist before any other nested stack can
 *  create API routes. Making them a nested stack means CloudFormation can 
 *  provision them, complete, and then let the spoke stacks add routes in
 *  parallel. It also moves those resources out of the root stack's count.
 */

class AdminApiCoreNestedStack extends NestedStack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Bind createScopedId from parent stack so constructs can use it
    this.createScopedId = scope.createScopedId;
    this.getAppName = scope.getAppName;
    this.getDeploymentName = scope.getDeploymentName;
    this.isOffline = scope.isOffline;

    const {
      corsPreflightAllowHeaders,
      corsPreflightMaxAgeSeconds,
      adminApiStageName,
      logLevel,
      adminUserPoolId,
      adminUserPoolClientId,
      referenceDataTableName,
      baseLayer,
      awsUtilsLayer,
      refDataTableArn,
      appName,
      deploymentName
    } = props;

    // Create the Admin Authorizer for the API Gateway
    this.adminAuthorizerConstruct = new AdminAuthorizerConstruct(this, 'AdminAuthorizer', {
      environment: {
        LOG_LEVEL: logLevel,
        ADMIN_USER_POOL_ID: adminUserPoolId || null,
        ADMIN_USER_POOL_CLIENT_ID: adminUserPoolClientId || null,
        API_STAGE: adminApiStageName,
        IS_OFFLINE: scope.isOffline() ? 'true' : 'false',
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ]
    });

    // Grant authorizer read access to the reference data table
    this.adminAuthorizerConstruct.adminAuthorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:BatchGetItem'
      ],
      resources: [refDataTableArn, `${refDataTableArn}/index/*`],
    }));

    const requestAuthorizer = this.adminAuthorizerConstruct.getRequestAuthorizer();

    // Create the Admin API Gateway
    this.adminApi = new apigw.RestApi(this, 'AdminApi', {
      restApiName: `${appName}-${deploymentName}-AdminApi`,
      description: `Admin API for ${appName} - ${deploymentName} environment`,
      // Deployment managed by parent stack 
      deploy: false,
      defaultCorsPreflightOptions: {
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: corsPreflightAllowHeaders,
        maxAge: Duration.seconds(corsPreflightMaxAgeSeconds || 600)
      },
    });

    // Store reference to the deployment for parent stack to use
    this.deployment = null;
    this.stage = null;

    // Attach the authorizer to the API Gateway
    requestAuthorizer._attachToApi(this.adminApi);

    // Outputs for other nested stacks to reference
    new CfnOutput(this, 'RestApiId', {
      value: this.adminApi.restApiId,
      exportName: `${appName}-${deploymentName}-AdminApiId`
    });

    new CfnOutput(this, 'RootResourceId', {
      value: this.adminApi.restApiRootResourceId,
      exportName: `${appName}-${deploymentName}-AdminApiRootResourceId`
    });
  }

  getRestApiId() {
    return this.adminApi.restApiId;
  }

  getRootResourceId() {
    return this.adminApi.restApiRootResourceId;
  }

  getAuthorizer() {
    return this.adminAuthorizerConstruct.getRequestAuthorizer();
  }

  // Method to add dependencies to the deployment
  addDeploymentDependency(dependency) {
    this.deployment.node.addDependency(dependency);
  }
}

module.exports = { AdminApiCoreNestedStack };
