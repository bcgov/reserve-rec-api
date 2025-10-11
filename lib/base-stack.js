const { logger, getSyncSecretFromSM, getParameterFromSSM } = require("./utils");
const { Stack } = require('aws-cdk-lib');

class BaseStack extends Stack {
  constructor(appScope, primer, props = {}) {

    super(appScope.app, primer?.stackId, {
      ...props,
      env: primer?.env
    });

    this.appScope = appScope;

    // Initialize stack properties
    this.stackKey = primer.stackKey || 'DEFAULT_STACK';
    this._stackId = primer?.stackId;
    this.configPath = primer.createConstructSSMPath('config');
    this.config = primer?.config || {};
    this.constructs = primer?.constructs || {};
    this.secrets = primer?.secrets || {};
    this.stackScope = {};

    // bind this to the app scope
    this.appScope.bindStackScope(this.stackKey, this);

    // bind some methods for convenience
    this.getDeploymentName = appScope.getDeploymentName.bind(appScope);
    this.isOffline = appScope.isOffline.bind(appScope);
    this.getAppName = appScope.getAppName.bind(appScope);
    this.getConstructId = appScope.getConstructId.bind(this);
    this.getConfigValue = appScope.getConfigValue.bind(this);
    this.getSecretValue = appScope.getSecretValue.bind(this);
    this.createScopedId = appScope.createScopedId.bind(appScope);
  }

  get stackId() {
    return this._stackId;
  }

  getConstructName(constructKey) {
    return this.constructs?.[constructKey]?.name;
  }

  getConstructByKey(constructKey) {
    return this.constructs?.[constructKey] || null;
  }

  getStackIdByKey(constructKey) {
    return this.constructs?.[constructKey]?._stackId || null;
  }

  getStackConfigByKey(valueKey) {
    return this.config?.[valueKey] || null;
  }

  getConstructName(constructKey) {
    return this.constants?.constructs?.[constructKey]?.name || constructKey;
  }

  setStackRef(stack) {
    this.stackRef = stack;
  }

}

module.exports = {
  BaseStack,
};