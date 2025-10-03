const { Stack } = require('aws-cdk-lib');
const { createConstruct, exportValue, getContextFromSSM, logger, stackNamer, sanitizeProps } = require('../../utils');
const contextDefaults = require('./default-context.json');
const { createTestLambda } = require('../../../src/handlers/events/constructs');
const { resolveBaseLayer } = require('../../../src/layers/resolvers');

class AdminLambdaStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const stackConstants = props?.CONSTANTS?.STACKS?.ADMIN_LAMBDA_STACK;
    const baseLayer = resolveBaseLayer(scope, props);

    const adminApi = props?.adminApi;

    if (!adminApi) {
      throw new Error("Admin API not provided to Admin Lambda Stack.");
    }

    // trial lambda
    const trialFunctionName = 'trialFunction';
    const trialFunction = createConstruct(this, trialFunctionName, {
      createFn: (id) => createTestLambda(this, id, {
        environment: sanitizeProps(props),
        layers: [baseLayer],
        api: adminApi,
        ...props
      }),
      exportFn: (construct) => exportValue(this, trialFunctionName, {
        value: construct.functionArn,
        pathSuffix: 'functionArn',
        ...props,
      }),
      ...props
    });

  }
}

async function createAdminLambdaStack(app, stackName, context) {
  try {
    logger.info(`Creating Admin Lambda Stack (${stackName}, ${context.ENVIRONMENT_NAME})`);
    // get environment configuration
    context = { ...contextDefaults, ...await getContextFromSSM(stackName, context), ...context };
    context['STACK_NAME'] = stackName; // ensure stack name is included in context

    const stack = new AdminLambdaStack(app, stackNamer(stackName, context), {
      description: `Admin Lambda Stack for ${context?.CONSTANTS?.APP_NAME} - ${context.ENVIRONMENT_NAME} environment`,
      ...context
    });

    logger.info(`${stackName} setup complete.\n`);
    return stack;

  } catch (error) {
    logger.error(`Error creating Admin Lambda Stack (${stackName}, ${context.ENVIRONMENT_NAME}): \n ${error}\n Stack may not have created properly.`);
    if (context?.FAIL_ON_ERROR === "true") {
      throw error;
    }
  }

}

module.exports = { createAdminLambdaStack };