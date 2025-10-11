const { Stack, RemovalPolicy, Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { logger } = require("../utils");
const { createAuthorizerFunction } = require('../../src/handlers/authorizers/constructs');
const path = require('path');

const defaults = {
  constructs: {
    adminAuthorizerFunction: {
      name: 'AdminAuthorizerFunction',
    },
    adminRequestAuthorizer: {
      name: 'AdminRequestAuthorizer',
    },
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

class AdminApiStack extends Stack {
  constructor(scope, id, props) {
    super(scope.app, id, props);

    logger.info(`Creating Admin API Stack: ${id}`);

    // Create an administrative authorizer Lambda function
    // Get the entry path for the authorizer function
    const authFunctionEntry = path.join(__dirname, '../../src/handlers/authorizers');
    // Function name from context
    this.adminAuthorizerFunction = createAuthorizerFunction(this, scope.getConstructId('adminAuthorizerFunction'), {
      authFunctionEntry: authFunctionEntry,
      handler: 'admin.handler',
      layers: [
        scope.getBaseLayer(),
      ],
      environment: {
        LOG_LEVEL: scope.getConfigValue('logLevel'),
      }
    });

    // Create the request authorizer
    const a = new apigw.RequestAuthorizer(this, scope.getConstructId('adminRequestAuthorizer'), {
      authorizerName: scope.getConstructId('adminRequestAuthorizer'),
      handler: this.adminAuthorizerFunction,
      identitySources: [apigw.IdentitySource.header('Authorization')],
    });

    // Create the Admin API Gateway
    const b = new apigw.RestApi(this, scope.getConstructId('adminApi'), {
      restApiName: scope.getConstructId('adminApi'),
      description: `Admin API for ${scope.getAppName()} - ${scope.getDeploymentName()} environment`,
      deploy: true,
      defaultCorsPreflightOptions: {
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS, // this is also the default
        allowHeaders: scope.getConfigValue('corsPreflightAllowHeaders'),
        maxAge: Duration.seconds(scope.getConfigValue('corsPreflightMaxAgeSeconds') || 600) // default to 1 day,
      },
      deployOptions: {
        stageName: scope.getConfigValue('adminApiStageName'),
      },
      defaultMethodOptions: {
        authorizer: a,
        authorizationType: apigw.AuthorizationType.CUSTOM,
      },
    });

    // Add getters to scope for other stacks to reference
    scope.getAdminApi = this.getAdminApi.bind(this);
  }

  // Getters for resources
  getAdminApi() {
    return ;
  }
}

async function createAdminApiStack(scope, stackKey) {
  try {
    await scope.addStackContext(stackKey, {
      constructs: defaults.constructs,
      config: defaults.config,
    });
    return new AdminApiStack(scope, scope.getStackId(stackKey));
  } catch (error) {
    logger.error(`Error creating Admin Api Stack:`, error);
  }
}

module.exports = {
  createAdminApiStack,
};