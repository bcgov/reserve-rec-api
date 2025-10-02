const { Stack, Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { createConstruct, exportValue, getContextFromSSM, logger, sanitizeProps, stackNamer } = require('../utils');
const contextDefaults = require('./default-context.json');
const { createAuthorizerFunction } = require('../../src/handlers/authorizers/constructs');
const path = require('path');

class AdminApiStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const stackConstants = props?.CONSTANTS?.STACKS?.ADMIN_API_STACK;

    // Create an administrative authorizer Lambda function
    // Get the entry path for the authorizer function
    const authFunctionEntry = path.join(__dirname, '../../src/handlers/authorizers');
    // Function name from context
    const authFunctionName = stackConstants?.ADMIN_AUTHORIZER_FUNCTION_NAME;
    // Create the authorizer function
    const adminAuthorizerFunction = createConstruct(this, authFunctionName, {
      createFn: (id) => createAuthorizerFunction(this, id, {
        authFunctionEntry: authFunctionEntry,
        handler: 'admin.handler',
        environment: sanitizeProps(props),
        ...props
      }),
      exportFn: (construct) =>
        exportValue(this, authFunctionName, {
          value: construct?.functionArn,
          pathSuffix: 'functionArn',
          ...props,
        }),
      ...props
    });

    // Create the Admin API Gateway
    const adminApiName = stackConstants?.ADMIN_API_NAME;
    const adminApi = createConstruct(this, adminApiName, {
      createFn: (id) => new apigw.RestApi(this, id, {
        restApiName: id,
        description: `Admin API for ${props?.CONSTANTS?.APP_NAME} - ${props.ENVIRONMENT_NAME} environment`,
        deploy: true,
        defaultCorsPreflightOptions: {
          allowCredentials: true,
          allowOrigins: apigw.Cors.ALL_ORIGINS,
          allowMethods: apigw.Cors.ALL_METHODS, // this is also the default
          allowHeaders: props?.CORS_PREFLIGHT_ALLOW_HEADERS,
          maxAge: Duration.seconds(props?.CORS_PREFLIGHT_MAX_AGE_SECONDS || 600) // default to 1 day,
        },
        deployOptions: {
          stageName: props?.ADMIN_API_STAGE_NAME,
        }
      }),
      exportFn: (construct) => exportValue(this, adminApiName, {
        value: construct?.restApiId,
        pathSuffix: 'restApiId',
        ...props,
      }),
      ...props
    });

  }
}

async function createAdminApiStack(app, stackName, context) {
  try {
    logger.info(`Creating Admin API Stack (${stackName}, ${context.ENVIRONMENT_NAME})`);
    // get environment configuration
    context = { ...contextDefaults, ...await getContextFromSSM(stackName, context), ...context };
    context['STACK_NAME'] = stackName; // ensure stack name is included in context

    const stack = new AdminApiStack(app, stackNamer(stackName, context), {
      description: `Admin API Stack for ${context?.CONSTANTS?.APP_NAME} - ${context.ENVIRONMENT_NAME} environment`,
      ...context
    });

    logger.info(`${stackName} setup complete.\n`);
    return stack;

  } catch (error) {
    logger.error(`Error creating Admin API Stack (${stackName}, ${context.ENVIRONMENT_NAME}): \n ${error}\n Stack may not have created properly.`);
  }
}

module.exports = { createAdminApiStack };
