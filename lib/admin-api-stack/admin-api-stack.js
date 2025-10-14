const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { logger, StackPrimer } = require("../utils");
const { BaseStack } = require('../base-stack');
const { AdminAuthorizerConstruct } = require("../../src/handlers/authorizers/constructs");

const defaults = {
  constructs: {
    adminAuthorizer: {
      name: 'AdminAuthorizer',
    },
    adminApi: {
      name: 'AdminApi',
    }
  },
  config: {
    corsPreflightAllowHeaders: [
      "Content-Type",
      "X-Amz-Date",
      "Authorization",
      "X-Api-Key",
      "X-Amz-Security-Token"
    ],
    corsPreflightMaxAgeSeconds: 600,
    logLevel: process.env.LOG_LEVEL || 'info',
    adminApiStageName: 'api',
    inheritAdminUserPoolSettingsFromDeployment: 'true',
    adminUserPoolId: '',
    adminUserPoolClientId: '',
  }
};

async function createAdminApiStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new AdminApiStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Admin Api Stack: ${error}`);
  }
}

class AdminApiStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Admin API Stack: ${this.stackId}`);

    // How the Authorizer determines User Pool settings:
    // If inheritAdminUserPoolSettingsFromDeployment is true, pull from the deployment stack
    // If false, use the values in config.adminUserPoolId and config.adminUserPoolClientId
    // If either of those are blank, look in DynamoDB for the deployment settings
    if (this.getConfigValue('inheritAdminUserPoolSettingsFromDeployment') === 'true') {
      // Pull in the user pool settings from the deployment stack
      this.setConfigValue('adminUserPoolId', scope.getAdminUserPoolId());
      this.setConfigValue('adminUserPoolClientId', scope.getAdminUserPoolClientId());
    }

    // Create the Admin Authorizer for the API Gateway
    this.adminAuthorizerConstruct = new AdminAuthorizerConstruct(this, this.getConstructId('adminAuthorizer'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        ADMIN_USER_POOL_ID: this.getConfigValue('adminUserPoolId') || null,
        ADMIN_USER_POOL_CLIENT_ID: this.getConfigValue('adminUserPoolClientId') || null,
        API_STAGE: this.getConfigValue('adminApiStageName'),
        IS_OFFLINE: scope.isOffline() ? 'true' : 'false',
      },
      layers: [
        scope.getBaseLayer(),
        scope.getAwsUtilsLayer(),
      ]
    });

    const requestAuthorizer = this.adminAuthorizerConstruct.getRequestAuthorizer();

    // Create the Admin API Gateway
    this.adminApi = new apigw.RestApi(this, this.getConstructId('adminApi'), {
      restApiName: this.getConstructId('adminApi'),
      description: `Admin API for ${this.getAppName()} - ${this.getDeploymentName()} environment`,
      deploy: true,
      defaultCorsPreflightOptions: {
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS, // this is also the default
        allowHeaders: this.getConfigValue('corsPreflightAllowHeaders'),
        maxAge: Duration.seconds(this.getConfigValue('corsPreflightMaxAgeSeconds') || 600) // default to 1 day,
      },
      deployOptions: {
        stageName: this.getConfigValue('adminApiStageName'),
      },
      defaultMethodOptions: {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: requestAuthorizer,
      }
    });

    // Attach the authorizer to the API Gateway
    // We need to do this here AND in the api defaultMethodOptions
    requestAuthorizer._attachToApi(this.adminApi);

    // Add getters to scope for other stacks to reference
    scope.getAdminApi = this.getAdminApi.bind(this);
  }

  // Getters for resources
  getAdminApi() {
    return this.adminApi;
  }
}

module.exports = {
  createAdminApiStack,
};