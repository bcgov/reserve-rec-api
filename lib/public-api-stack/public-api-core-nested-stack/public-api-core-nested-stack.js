'use strict';

const apigw = require('aws-cdk-lib/aws-apigateway');
const { NestedStack, CfnOutput, Duration } = require('aws-cdk-lib');
const { PublicAuthorizerConstruct } = require('../../../src/handlers/authorizers/constructs');

/**
 * NestedStack for core Public API resources - API Gateway, Authorizer,
 * and shared outputs.
 *
 * The RestApi and the Authorizer must exist before any other nested stack can
 * create API routes. Making them a nested stack means CloudFormation can
 * provision them, complete, and then let the spoke stacks add routes in
 * parallel. It also moves those resources out of the root stack's count.
 */
class PublicApiCoreNestedStack extends NestedStack {
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
      publicApiStageName,
      logLevel,
      publicUserPoolId,
      publicUserPoolClientId,
      opensearchDomainArn,
      baseLayer,
      awsUtilsLayer,
      appName,
      deploymentName,
    } = props;

    // Create the Public Authorizer for the API Gateway
    this.publicAuthorizerConstruct = new PublicAuthorizerConstruct(this, 'PublicAuthorizer', {
      environment: {
        LOG_LEVEL: logLevel,
        OPENSEARCH_DOMAIN_ARN: opensearchDomainArn,
        PUBLIC_USER_POOL_ID: publicUserPoolId || null,
        PUBLIC_USER_POOL_CLIENT_ID: publicUserPoolClientId || null,
      },
      layers: [baseLayer, awsUtilsLayer],
      description: `Public Authorizer for ${appName}-${deploymentName} environment`,
    });

    const requestAuthorizer = this.publicAuthorizerConstruct.getRequestAuthorizer();

    // Create the Public API Gateway
    this.publicApi = new apigw.RestApi(this, 'PublicApi', {
      restApiName: `${appName}-${deploymentName}-PublicApi`,
      description: `Public API for ${appName} - ${deploymentName} environment`,
      // Deployment managed by parent stack
      deploy: false,
      defaultCorsPreflightOptions: {
        allowCredentials: true,
        allowHeaders: corsPreflightAllowHeaders,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        maxAge: Duration.seconds(corsPreflightMaxAgeSeconds || 600),
      },
    });

    // Attach the authorizer to the API Gateway
    requestAuthorizer._attachToApi(this.publicApi);

    // Outputs for other nested stacks to reference
    new CfnOutput(this, 'RestApiId', {
      value: this.publicApi.restApiId,
      exportName: `${appName}-${deploymentName}-PublicApiId`,
    });

    new CfnOutput(this, 'RootResourceId', {
      value: this.publicApi.restApiRootResourceId,
      exportName: `${appName}-${deploymentName}-PublicApiRootResourceId`,
    });
  }

  getRestApiId() {
    return this.publicApi.restApiId;
  }

  getRootResourceId() {
    return this.publicApi.restApiRootResourceId;
  }

  getAuthorizer() {
    return this.publicAuthorizerConstruct.getRequestAuthorizer();
  }
}

module.exports = { PublicApiCoreNestedStack };
