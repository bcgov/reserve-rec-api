const { Stack } = require('aws-cdk-lib');
const { createConstruct, getContextFromSSM, logger, stackNamer, exportValue } = require('../utils');
const contextDefaults = require('./default-context.json');
const { createBaseLayer } = require('../../src/layers/constructs');

class CoreStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const stackConstants = props?.CONSTANTS?.STACKS?.CORE_STACK;

    const baseLayerName = stackConstants?.BASE_LAYER_NAME;
    const baseLayer = createConstruct(this, baseLayerName, {
      createFn: (id) => createBaseLayer(this, id, props),
      exportFn: (construct) => exportValue(this, baseLayerName, {
        value: construct?.layerVersionArn,
        pathSuffix: 'layerVersionArn',
        ...props,
      }),
      ...props
    });

  }
}


async function createCoreStack(app, stackName, context) {
  try {
    logger.info(`Creating Core Stack (${stackName}, ${context.ENVIRONMENT_NAME})`);
    // get environment configuration
    context = { ...contextDefaults, ...await getContextFromSSM(stackName, context), ...context };
    context['STACK_NAME'] = stackName; // ensure stack name is included in context

    const stack = new CoreStack(app, stackNamer(stackName, context), {
      description: `Core Stack for ${context?.CONSTANTS?.APP_NAME} - ${context.ENVIRONMENT_NAME} environment`,
      ...context
    });
    logger.info(`${stackName} setup complete.\n`);
    return stack;
  } catch (error) {
    logger.error(`Error creating Core Stack (${stackName}, ${context.ENVIRONMENT_NAME}): \n ${error}\n Stack may not have created properly.`);
    if (context?.FAIL_ON_ERROR === "true") {
      throw error;
    }
  }
}

module.exports = {
  createCoreStack,
};