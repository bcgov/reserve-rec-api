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
const { createEmailDispatchStack } = require('../lib/email-dispatch-stack/email-dispatch-stack.js');

/**
 * Main CDK Project class that orchestrates the creation and management of all CDK stacks
 * for the Reserve Recreation API infrastructure.
 */
class CDKProject {
  /**
   * Creates a new CDKProject instance with initialized configuration and state tracking.
   * Initializes the CDK app, context, stacks registry, and deployment progress tracking.
   */
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

  /**
   * Builds the complete CDK project by creating all stacks and managing their dependencies.
   * Displays project configuration, creates stacks in dependency order, and summarizes results.
   *
   * @async
   * @returns {Promise<void>} Resolves when all stacks are created or deployment fails
   */
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

  /**
   * Gets the application name used for resource naming and identification.
   *
   * @returns {string} The application name 'ReserveRecApi'
   */
  getAppName() {
    return this.appName;
  }

  /**
   * Gets the deployment environment name from the CDK context.
   * Used for environment-specific resource naming and configuration.
   *
   * @returns {string} The deployment environment name (dev, test, prod) or 'local' as default
   */
  getDeploymentName() {
    return this.context?.DEPLOYMENT_NAME || 'local';
  }

  /**
   * Gets the AWS region for resource deployment from the CDK context.
   *
   * @returns {string} The AWS region code, defaults to 'ca-central-1'
   */
  getRegion() {
    return this.context?.AWS_REGION || 'ca-central-1';
  }

  /**
   * Checks if the deployment is running in offline/local mode.
   *
   * @returns {boolean} True if running offline, false otherwise
   */
  isOffline() {
    return this.context?.IS_OFFLINE === 'true' || false;
  }

  /**
   * Retrieves the CDK context configuration for the current deployment environment.
   * The context contains environment-specific settings like region, deployment name, etc.
   *
   * @returns {Object} The context configuration object
   * @throws {Error} If context retrieval fails
   */
  getContext() {
    try {
      let contextName = this.app.node.getContext('@context');
      logger.debug('Retrieving context for:', contextName);
      return this.app.node.tryGetContext(contextName);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Retrieves a configuration value from the current stack or a specified stack.
   * Logs a warning if the configuration key is not found.
   *
   * @param {string} key - The configuration key to retrieve
   * @param {string|null} [stackKey=null] - Optional stack key to search in. If null, uses current stack
   * @returns {*} The configuration value or undefined if not found
   */
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

  /**
   * Sets a configuration value in the current stack or a specified stack.
   * Initializes the config object if it doesn't exist.
   *
   * @param {string} key - The configuration key to set
   * @param {*} value - The value to set
   * @param {string|null} [stackKey=null] - Optional stack key to set in. If null, uses current stack
   */
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

  /**
   * Retrieves a secret value from AWS Secrets Manager configuration.
   * Logs a warning if the secret key is not found.
   *
   * @param {string} key - The secret key to retrieve
   * @param {string|null} [stackKey=null] - Optional stack key to search in. If null, uses current stack
   * @returns {string|null} The secret value or null if not found
   */
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

  /**
   * Retrieves a construct configuration object by its key from the current stack or a specified stack.
   *
   * @param {string} constructKey - The key identifier of the construct to find
   * @param {string|null} [stackKey=null] - Optional stack key to search in. If null, uses current stack
   * @returns {Object|null} The construct configuration object or null if not found
   */
  getConstructByKey(constructKey, stackKey = null) {
    // 'this' pertains to the current/bound stack
    let self = this;
    if (stackKey) {
      self = this.getStackByKey(stackKey);
    }
    return self?.constructs?.[constructKey] || null;
  }

  /**
   * Retrieves the CDK construct ID for a given construct key.
   * Throws an error if the construct is not found.
   *
   * @param {string} constructKey - The key identifier of the construct
   * @param {string|null} [stackKey=null] - Optional stack key to search in. If null, uses current stack
   * @returns {string|null} The construct ID or null if the construct has no ID
   * @throws {Error} If the construct is not found in the stack
   */
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

  /**
   * Retrieves a stack instance by its key identifier.
   *
   * @param {string} stackKey - The key identifier of the stack to retrieve
   * @returns {Object|undefined} The stack instance or undefined if not found
   */
  getStackByKey(stackKey) {
    return this.stacks[stackKey];
  }

  /**
   * Gets the currently active stack based on the deployment progress tracking.
   *
   * @returns {Object|undefined} The current stack instance or undefined if no current stack
   */
  getCurrentStack() {
    return this.stacks[this.progress.currentStackKey];
  }

  /**
   * Gets the ID of the currently active stack.
   *
   * @returns {string|undefined} The current stack ID or undefined if no current stack
   */
  getStackId() {
    return this.getCurrentStack()?.id;
  }

  /**
   * Creates and adds a new stack context with initialization.
   *
   * @async
   * @param {string} stackKey - The unique key identifier for the stack
   * @param {Object} [props={}] - Optional properties for stack context creation
   * @returns {Promise<Object>} The initialized stack context instance
   */
  async addStackContext(stackKey, props = {}) {
    const stackContext = new StackContext(this, stackKey, props);
    await stackContext.init();
    this.stacks[stackKey] = stackContext;
    return stackContext;
  }

  /**
   * Creates all CDK stacks in the proper dependency order.
   * Establishes stack dependencies to ensure correct deployment sequence.
   *
   * @async
   * @returns {Promise<void>} Resolves when all stacks are created
   */
  async createStacks() {
    logger.info('Starting CDK application synthesis...\n');

    const coreStack = await this.addStack('coreStack', createCoreStack);
    const adminIdentityStack = await this.addStack('adminIdentityStack', createAdminIdentityStack);
    const publicIdentityStack = await this.addStack('publicIdentityStack', createPublicIdentityStack);
    const openSearchStack = await this.addStack('openSearchStack', createOpenSearchStack);
    const transactionalDataStack = await this.addStack('transactionalDataStack', createTransactionalDataStack);
    const bookingWorkflowStack = await this.addStack('bookingWorkflowStack', createBookingWorkflowStack);
    const emailDispatchStack = await this.addStack('emailDispatchStack', createEmailDispatchStack);
    const referenceDataStack = await this.addStack('referenceDataStack', createReferenceDataStack);
    const adminApiStack = await this.addStack('adminApiStack', createAdminApiStack);
    const publicApiStack = await this.addStack('publicApiStack', createPublicApiStack);

    publicApiStack.addDependency(referenceDataStack);
    publicApiStack.addDependency(bookingWorkflowStack);
    publicApiStack.addDependency(emailDispatchStack);
    adminApiStack.addDependency(referenceDataStack);
    openSearchStack.addDependency(adminIdentityStack);
    openSearchStack.addDependency(publicIdentityStack);
    bookingWorkflowStack.addDependency(coreStack);
    bookingWorkflowStack.addDependency(transactionalDataStack);
    emailDispatchStack.addDependency(coreStack);
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

  /**
   * Creates a single stack using the provided creation function.
   * Handles error tracking and progress monitoring.
   *
   * @async
   * @param {string} stackKey - The unique key identifier for the stack
   * @param {Function} stackCreateFn - The function that creates the stack
   * @returns {Promise<Object>} The created stack instance
   * @throws {Error} If FAIL_FAST is enabled and stack creation fails
   */
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

  /**
   * Adds a group and role pair to the project registry with cross-references.
   * Creates bidirectional links between the group and role.
   *
   * @param {string} key - The unique identifier for the group-role pair
   * @param {Object} group - The group configuration object
   * @param {Object} role - The role configuration object
   */
  addGroupWithRole(key, group, role) {
    this.groups[key] = group;
    this.groups[key]['role'] = key;
    this.roles[key] = role;
    this.roles[key]['group'] = key;
  }

  /**
   * Adds a role to the project registry.
   *
   * @param {string} roleKey - The unique identifier for the role
   * @param {Object} role - The role configuration object
   */
  addRole(roleKey, role) {
    this.roles[roleKey] = role;
  }

  /**
   * Gets all registered roles in the project.
   *
   * @returns {Object} Object containing all role configurations keyed by role identifier
   */
  getRoles() {
    return this.roles;
  }

  /**
   * Retrieves a specific role by its key identifier.
   *
   * @param {string} roleKey - The unique identifier of the role to retrieve
   * @returns {Object|undefined} The role configuration object or undefined if not found
   */
  getRoleByKey(roleKey) {
    return this.roles[roleKey];
  }

  /**
   * Adds a group to the project registry with optional expected role ARN.
   *
   * @param {string} groupKey - The unique identifier for the group
   * @param {Object} group - The group configuration object
   * @param {string|null} [expectedRoleArn=null] - Optional ARN of the expected role for this group
   */
  addGroup(groupKey, group, expectedRoleArn = null) {
    if (expectedRoleArn) {
      group['expectedRoleArn'] = expectedRoleArn;
    }
    this.groups[groupKey] = group;
  }

  /**
   * Gets all registered groups in the project.
   *
   * @returns {Object} Object containing all group configurations keyed by group identifier
   */
  getGroups() {
    return this.groups;
  }

  /**
   * Retrieves a specific group by its key identifier.
   *
   * @param {string} groupKey - The unique identifier of the group to retrieve
   * @returns {Object|undefined} The group configuration object or undefined if not found
   */
  getGroupByKey(groupKey) {
    return this.groups[groupKey];
  }

  /**
   * Creates a standardized stack ID using app name, deployment name, and stack key.
   * Follows the naming pattern: {AppName}-{DeploymentName}-{StackKey}
   *
   * @param {string} stackKey - The stack key identifier
   * @returns {string} The formatted stack ID
   * @throws {Error} If any required part (app name, deployment name, or stack key) is missing
   */
  createStackId(stackKey) {
    let parts = [this.getAppName(), this.getDeploymentName(), stackKey];
    for (const part of parts) {
      if (!part) {
        throw new Error(`Missing required part to construct stack ID: ${JSON.stringify(parts)}`);
      }
    }
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
  }

  /**
   * Binds a stack scope to a stack key in the project registry.
   *
   * @param {string} stackKey - The unique identifier for the stack
   * @param {Object} stackScope - The stack scope/instance to bind
   */
  bindStackScope(stackKey, stackScope) {
    this.stacks[stackKey] = stackScope;
  }

  /**
   * Retrieves the stack scope/instance for a given stack key.
   *
   * @param {string} stackKey - The unique identifier of the stack
   * @returns {Object|undefined} The stack scope/instance or undefined if not found
   */
  getStackScope(stackKey) {
    return this.stacks[stackKey];
  }

  /**
   * Initializes and binds a stack scope, then returns it.
   * Convenience method that combines binding and retrieval.
   *
   * @param {string} stackKey - The unique identifier for the stack
   * @param {Object} stackScope - The stack scope/instance to initialize
   * @returns {Object} The initialized stack scope/instance
   */
  initStackScope(stackKey, stackScope) {
    this.bindStackScope(stackKey, stackScope);
    return this.getStackScope(stackKey);
  }

  /**
   * Creates a scoped identifier by appending a suffix to the base ID.
   * Used for creating unique construct identifiers within stacks.
   *
   * @param {string} id - The base identifier
   * @param {string} [suffix='Construct'] - The suffix to append
   * @returns {string} The scoped identifier in format 'id-suffix'
   */
  createScopedId(id, suffix = 'Construct') {
    return id + '-' + suffix;
  }

  /**
   * Displays a formatted summary of the CDK deployment progress.
   * Shows total stacks, completed stacks, and any failed stacks with colored output.
   */
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

/**
 * Main execution function that creates and builds the CDK project.
 * Handles top-level error catching and logging for the entire deployment process.
 *
 * @async
 * @returns {Promise<void>} Resolves when the project build completes
 */
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
