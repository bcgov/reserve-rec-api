const cdk = require('aws-cdk-lib');
const { StackContext } = require('../lib/stack-context.js');
const { createAdminApiStack } = require('../lib/admin-api-stack/admin-api-stack.js');
const { createAdminIdentityStack } = require('../lib/admin-identity-stack/admin-identity-stack.js');
const { logger } = require('../lib/utils');
const { createCoreStack } = require('../lib/core-stack/core-stack.js');
const { createPublicIdentityStack } = require('../lib/public-identity-stack/public-identity-stack.js');

class ReserveRecApiApp {
  constructor() {
    this.app = new cdk.App();
    this.appName = 'ReserveRecApi';
    this.context = this.getContext();
    this.stacks = {};
    this.progress = {
      completedStacks: [],
      failedStacks: [],
      totalStacks: 0,
      currentStackKey: null,
    };

    this.createStacks();
  }

  getAppName() {
    return this.appName;
  }

  getDeploymentName() {
    return this.context?.DEPLOYMENT_NAME || 'local';
  }

  getEnv() {

  }

  isOffline() {
    return this.context?.IS_OFFLINE === 'true' || false;
  }

  getContext() {
    try {
      let contextName = this.app.node.getContext('@context');
      logger.debug('Retrieving context for:', contextName);
      return this.app.node.tryGetContext(contextName);
    } catch (error) {
      throw error;
    }
  }

  getConfigValue(key, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    const config = self?.config;
    if (config === null || config === undefined) {
      logger.warn(`Config key ${key} not found in stack ${self?.stackKey}`);
    }
    return config[key];
  }

  getSecretValue(key, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    const secret = self?.secrets?.[key];
    if (secret === null || secret === undefined) {
      logger.warn(`Secret key ${key} not found in stack ${self?.stackKey}`);
    }
    return secret?.value || null;
  }

  getConstructByKey(constructKey, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    return self?.constructs?.[constructKey] || null;
  }

  getConstructId(constructKey, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    const construct = self.getConstructByKey(constructKey);
    if (!construct) {
      logger.warn(`Construct ${constructKey} not found in stack ${self.stackKey}`);
    }
    return construct?.id || null;
  }

  getStackByKey(stackKey) {
    return this.stacks[stackKey];
  }

  getCurrentStack() {
    return this.stacks[this.progress.currentStackKey];
  }

  getStackId() {
    return this.getCurrentStack()?.id;
  }

  async addStackContext(stackKey, props = {}) {
    const stackContext = new StackContext(this, stackKey, props);
    await stackContext.init();
    this.stacks[stackKey] = stackContext;
    return stackContext;
  }

  async createStacks() {
    logger.info('Starting CDK application synthesis...\n');

    await this.addStack('coreStack', createCoreStack);
    await this.addStack('adminIdentityStack', createAdminIdentityStack);
    await this.addStack('publicIdentityStack', createPublicIdentityStack);
    // await this.addStack('adminIdentityStack', createAdminIdentityStack);
    // await this.addStack('adminApiStack', createAdminApiStack);

  }

  async addStack(stackKey, stackCreateFn) {
    try {
      this.progress.totalStacks += 1;
      this.progress.currentStackKey = stackKey;
      logger.info(`Priming stack - Key: ${stackKey}`);
      this.stacks[stackKey] = await stackCreateFn(this, stackKey);
      this.progress.completedStacks.push(stackKey);
      logger.info(`Stack created: ${stackKey}\n`);
    } catch (error) {
      this.progress.failedStacks.push(stackKey);
      logger.error(`Error creating stack ${stackKey}:`, error);
    }
  }

  createStackId(stackKey) {
    let parts = [this.getAppName(), this.getDeploymentName(), stackKey];
    for (const part of parts) {
      if (!part) {
        throw new Error(`Missing required part to construct stack ID: ${JSON.stringify(parts)}`);
      }
    }
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
  }

  bindStackScope(stackKey, stackScope) {
    this.stacks[stackKey] = stackScope;
  }

  getStackScope(stackKey) {
    return this.stacks[stackKey];
  }

  initStackScope(stackKey, stackScope) {
    this.bindStackScope(stackKey, stackScope);
    return this.getStackScope(stackKey);
  }

  createScopedId(id, suffix = '-Construct') {
    return id + suffix;
  }
}

new ReserveRecApiApp();

module.exports = {
  ReserveRecApiApp
};
