const { logger, StackPrimer } = require("../utils");
const { PingApiConstruct } = require("../../src/handlers/ping/constructs");
const { BaseStack } = require('../base-stack');

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

    const adminApi = scope.getAdminApi();
    if (!adminApi) {
      throw new Error('AdminLambdaStack: Admin API Gateway not found in scope. Ensure AdminApiStack is created before AdminLambdaStack.');
    }

    this.adminPingApiConstruct = new PingApiConstruct(this, this.getConstructId('adminPingApi'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        API_NAME: adminApi.physicalName,
      },
      layers: [
        scope.getBaseLayer(),
        scope.getAwsUtilsLayer(),
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