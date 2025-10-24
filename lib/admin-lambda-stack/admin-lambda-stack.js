const { logger, StackPrimer } = require("../helpers/utils");
const { PingApiConstruct } = require("../../src/handlers/ping/constructs");
const { BaseStack } = require('../helpers/base-stack');

const defaults = {
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  constructs: {
    adminPingApi: {
      name: 'AdminPingApi',
    }
  },
  secrets: {}
};

class AdminLambdaStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Admin Lambda Stack: ${this.stackId}`);

    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);

    const adminApi = scope.getAdminApi(this);
    if (!adminApi) {
      throw new Error('AdminLambdaStack: Admin API Gateway not found in scope. Ensure AdminApiStack is created before AdminLambdaStack.');
    }

    this.adminPingApiConstruct = new PingApiConstruct(this, this.getConstructId('adminPingApi'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        API_NAME: adminApi.physicalName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: adminApi,
    });

  }
}

async function createAdminLambdaStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new AdminLambdaStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Admin Lambda Stack: ${error}`);
  }
}

module.exports = {
  createAdminLambdaStack,
};