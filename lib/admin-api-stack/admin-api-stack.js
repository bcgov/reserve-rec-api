const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { logger, StackPrimer } = require("../utils");
const { createAuthorizerFunction } = require('../../src/handlers/authorizers/constructs');
const { BaseStack } = require('../base-stack');
const { AdminAuthorizerConstruct } = require("../../src/handlers/authorizers/constructs");
const path = require('path');

const defaults = {
  constructs: {
    adminAuthorizer: {
      name: 'AdminAuthorizer',
    },
    // adminRequestAuthorizer: {
    //   name: 'AdminRequestAuthorizer',
    // },
    adminApi: {
      name: 'AdminApi',
    }
  },
  values: {
    corsPreflightAllowHeaders: [
      "Content-Type",
      "X-Amz-Date",
      "Authorization",
      "X-Api-Key",
      "X-Amz-Security-Token"
    ],
    corsPreflightMaxAgeSeconds: 600,
    logLevel: 'info',
    adminApiStageName: 'admin',
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

    this.adminAuthorizerConstruct = new AdminAuthorizerConstruct(this, this.getConstructId('adminAuthorizer'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        ADMIN_USER_POOL_ID: '1234',
        ADMIN_USER_POOL_CLIENT_ID: '5678',
      },
      layers: [
        scope.getBaseLayer(),
      ]
    });

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
      }
    });

    // Attach the authorizer to the API Gateway
    const requestAuthorizer = this.adminAuthorizerConstruct.getRequestAuthorizer();
    requestAuthorizer._attachToApi(this.adminApi);

    // Add getters to scope for other stacks to reference
    scope.getAdminApi = this.getAdminApi.bind(this);
  }

  // Getters for resources
  getAdminApi() {
    return;
  }
}

module.exports = {
  createAdminApiStack,
};