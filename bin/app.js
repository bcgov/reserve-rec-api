const cdk = require('aws-cdk-lib');
const { createAdminApiStack } = require('../lib/admin-api-stack/admin-api-stack.js');
const { createAdminIdentityStack } = require('../lib/admin-identity-stack/admin-identity-stack.js');
const { logger } = require('../lib/helpers/utils.js');
const { createCoreStack } = require('../lib/core-stack/core-stack.js');
const { createPublicIdentityStack } = require('../lib/public-identity-stack/public-identity-stack.js');
const { createOpenSearchStack } = require('../lib/opensearch-stack/opensearch-stack.js');
const { createReferenceDataStack } = require('../lib/reference-data-stack/reference-data-stack.js');
const { createPublicApiStack } = require('../lib/public-api-stack/public-api-stack.js');
const { createTransactionalDataStack } = require('../lib/transactional-data-stack/transactional-data-stack.js');
const { createBookingWorkflowStack } = require('../lib/booking-workflow-stack/booking-workflow-stack.js');

class CDKProject {
  constructor() {
    this.app = new cdk.App();
    this.appName = 'ReserveRecApi';
    this.context = this.getContext();
    this.stacks = {};
    this.roles = {};
    this.groups = {};
    this.registeredRefs = new Map();
    this.progress = {
      completedStacks: [],
      failedStacks: [],
      totalStacks: 0,
      currentStackKey: null,
    };

  }

  async buildProject() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`\x1b[36mAPP NAME:\x1b[0m ${this.getAppName()}`);
    console.log(`\x1b[36mDEPLOYMENT NAME:\x1b[0m ${this.getDeploymentName()}`);
    console.log(`\x1b[36mAWS REGION:\x1b[0m ${this.getRegion()}`);
    console.log(`${'='.repeat(50)}\n`);
    console.log(`Starting CDK application synthesis...\n`);
    await this.createStacks();
    console.log(`\n${'='.repeat(50)}`);
    this.summarizeProgress();
    console.log(`${'='.repeat(50)}\n`);
  }

  getAppName() {
    return this.appName;
  }

  getDeploymentName() {
    return this.context?.DEPLOYMENT_NAME || 'local';
  }

  getRegion() {
    return this.context?.AWS_REGION || 'ca-central-1';
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

  setConfigValue(key, value, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    if (!self?.config) {
      self.config = {};
    }
    self.config[key] = value;
  }

  getSecretValue(key, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    const secret = self?.secrets?.[key];
    if (secret === null || secret === undefined) {
      logger.warn(`Secret key ${key} not found in stack ${self?.stackKey}. Check configured stack defaults.secrets for ${key} property.`);
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
      throw new Error(`Construct ${constructKey} not found in stack ${self.stackKey}. Check configured stack defaults.constructs for 'name' property for ${constructKey}.`);
    }
    return construct?.id || null;
  }

  /**
   * Retrieves the local name (stack specific) of a construct by its key from the current stack or a specified stack.
   *
   * @param {string} constructKey - The key identifier of the construct to find
   * @param {string|null} [stackKey=null] - Optional stack key to search in. If null, uses current stack
   * @returns {string|null} The name of the construct if found, null otherwise
   * @description If the construct is not found, a warning is logged and null is returned
   */
  getConstructName(constructKey, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    const construct = self.getConstructByKey(constructKey);
    if (!construct) {
      logger.warn(`Construct ${constructKey} not found in stack ${self.stackKey}. Check configured stack defaults.config for ${constructKey} property.`);
    }
    return construct?.name || null;
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

    const coreStack = await this.addStack('coreStack', createCoreStack);
    const adminIdentityStack = await this.addStack('adminIdentityStack', createAdminIdentityStack);
    const publicIdentityStack = await this.addStack('publicIdentityStack', createPublicIdentityStack);
    const openSearchStack = await this.addStack('openSearchStack', createOpenSearchStack);
    const transactionalDataStack = await this.addStack('transactionalDataStack', createTransactionalDataStack);
    const bookingWorkflowStack = await this.addStack('bookingWorkflowStack', createBookingWorkflowStack);
    const referenceDataStack = await this.addStack('referenceDataStack', createReferenceDataStack);
    const adminApiStack = await this.addStack('adminApiStack', createAdminApiStack);
    const publicApiStack = await this.addStack('publicApiStack', createPublicApiStack);
    // const roleAggregatorStack = await this.addStack('roleAggregatorStack', createRoleAggregatorStack);

    publicApiStack.addDependency(referenceDataStack);
    adminApiStack.addDependency(referenceDataStack);
    openSearchStack.addDependency(adminIdentityStack);
    openSearchStack.addDependency(publicIdentityStack);
    bookingWorkflowStack.addDependency(coreStack);
    bookingWorkflowStack.addDependency(referenceDataStack);
    referenceDataStack.addDependency(coreStack);
    referenceDataStack.addDependency(openSearchStack);
    transactionalDataStack.addDependency(coreStack);
    transactionalDataStack.addDependency(openSearchStack);
    adminIdentityStack.addDependency(coreStack);
    publicIdentityStack.addDependency(coreStack);
    // roleAggregatorStack.addDependency(adminIdentityStack);
    // roleAggregatorStack.addDependency(publicIdentityStack);
    // roleAggregatorStack.addDependency(openSearchStack);

  }

  async addStack(stackKey, stackCreateFn) {
    try {
      this.progress.totalStacks += 1;
      this.progress.currentStackKey = stackKey;
      logger.info(`Priming stack - Key: ${stackKey}`);
      this.stacks[stackKey] = await stackCreateFn(this, stackKey);
      this.progress.completedStacks.push(stackKey);
      logger.info(`Stack created: ${stackKey}\n`);
      return this.stacks[stackKey];
    } catch (error) {
      this.progress.failedStacks.push(stackKey);
      if (this.context?.FAIL_FAST === 'true') {
        throw new Error(`Error creating stack ${stackKey}: ${error}`);
      } else {
        logger.error(`Error creating stack ${stackKey}:`, error);
      }
    }
  }

  addGroupWithRole(key, group, role) {
    this.groups[key] = group;
    this.groups[key]['role'] = key;
    this.roles[key] = role;
    this.roles[key]['group'] = key;
  }

  addRole(roleKey, role) {
    this.roles[roleKey] = role;
  }

  getRoles() {
    return this.roles;
  }

  getRoleByKey(roleKey) {
    return this.roles[roleKey];
  }

  addGroup(groupKey, group, expectedRoleArn = null) {
    if (expectedRoleArn) {
      group['expectedRoleArn'] = expectedRoleArn;
    }
    this.groups[groupKey] = group;
  }

  getGroups() {
    return this.groups;
  }

  getGroupByKey(groupKey) {
    return this.groups[groupKey];
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

  createScopedId(id, suffix = 'Construct') {
    return id + '-' + suffix;
  }

  summarizeProgress() {
    console.log('\x1b[32mCDK Application Synthesis Complete.\x1b[0m');
    console.log(`\x1b[36mTotal Stacks:\x1b[0m ${this.progress.totalStacks}`);
    console.log(`\x1b[36mCompleted Stacks:\x1b[0m ${this.progress.completedStacks.length}`);
    if (this.progress.failedStacks.length > 0) {
      console.log(`\x1b[33mFailed Stacks:\x1b[0m ${this.progress.failedStacks.length}`);
      console.log(`\x1b[33mFailed Stack Keys:\x1b[0m ${this.progress.failedStacks.join(', ')}`);
    } else {
      console.log('\x1b[32mAll stacks created successfully.\x1b[0m');
    }
  }
}

async function run() {
  const project = new CDKProject();
  try {
    await project.buildProject();
    // await updateAppConfigItems(project);
  } catch (error) {
    logger.error('Error during CDK application synthesis:', error);
  }
}

run();

module.exports = {
  CDKProject,
};
