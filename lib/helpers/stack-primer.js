const { CfnOutput } = require('aws-cdk-lib');
const { logger } = require('./utils');
const { getParameterFromSSM, getSyncSecretFromSM } = require('./utils');

/**
 * StackPrimer class handles the initialization and configuration of CDK stacks.
 * Manages construct naming, configuration loading from SSM/local files, and secret resolution.
 */
class StackPrimer {
  /**
   * Creates a new StackPrimer instance with stack configuration and environment setup.
   * Binds convenience methods from the scope and initializes stack metadata.
   *
   * @param {Object} scope - The CDK project scope containing app-wide methods and context
   * @param {string} stackKey - The unique identifier for this stack
   * @param {Object} [defaults={}] - Default configuration object containing config, constructs, secrets, and description
   * @param {Object} [defaults.config={}] - Default configuration values for the stack
   * @param {Object} [defaults.constructs={}] - Default construct definitions for the stack
   * @param {Object} [defaults.secrets={}] - Default secret definitions for the stack
   * @param {string} [defaults.description] - Default description for the stack
   */
  constructor(scope, stackKey, defaults = {}) {

    // Bind some methods for convenience
    this.getDeploymentName = scope.getDeploymentName.bind(scope);
    this.getAppName = scope.getAppName.bind(scope);
    this.isOffline = scope.isOffline.bind(scope);

    this.stackKey = stackKey;
    this.stackId = scope.createStackId(stackKey);
    this.scope = scope;
    this.configPath = this.createConstructSSMPath('config');
    this.config = defaults?.config || {};
    this.constructs = defaults?.constructs || {};
    this.secrets = defaults?.secrets || {};
    this.description = defaults?.description || `Stack for ${stackKey}`;
    this.env = {
      account: scope.context.DEFAULT_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT || '000000000000',
      region: scope.context.DEFAULT_REGION || process.env.CDK_DEFAULT_REGION || 'ca-central-1'
    }
  }

  /**
   * Main initialization method that prepares the stack for creation.
   * Orchestrates construct naming, configuration loading, and secret resolution.
   *
   * @async
   * @returns {Promise<void>} Resolves when stack priming is complete
   * @throws {Error} If any priming step fails
   */
  async prime() {
    this.nameConstructs();
    await this.getDeploymentConfig();
    await this.getSecrets(this.appScope);
  }

  /**
   * Processes and names all constructs defined for this stack.
   * Generates CDK identifiers, SSM paths, and CloudFormation output paths for each construct.
   *
   * @throws {Error} If any construct is missing the required 'name' property
   */
  nameConstructs() {
    for (const [key, construct] of Object.entries(this.constructs)) {
      if (construct.hasOwnProperty('name')) {
        construct.key = key;
        construct.name = construct?.name || 'Construct';
        construct.id = this.createConstructId(construct);
        construct.ssmPath = this.createConstructSSMPath(key);
        construct.cfnOutput = this.createConstructCfnOutputPath(key);
      } else {
        throw new Error(`Construct ${key} is missing a 'name' property.`);
      }
    }
  }

  /**
   * Loads deployment-specific configuration from either local files or AWS SSM Parameter Store.
   * For local/offline environments, loads from env.json. For other environments, loads from SSM.
   *
   * @async
   * @returns {Promise<void>} Resolves when configuration is loaded and merged
   * @throws {Error} If configuration retrieval fails or parsing errors occur
   */
  async getDeploymentConfig() {
    try {
      if (this.getDeploymentName() === 'local' || this.isOffline()) {
        logger.debug('Loading local/offline context from env.json');
        // Local or offline environment
        const localContext = require('../env.json');
        if (!localContext?.stackContexts?.[this.stackKey]) {
          logger.warn(`Local context for stack ${this.stackKey} not found in env.json`);
        } else {
          this.config = Object.assign(this.config, localContext?.stackContexts?.[this.stackKey]);
        }
      } else {
        logger.debug('Loading context from SSM Parameter Store');
        // Production or other environments
        const retrievedConfig = await getParameterFromSSM(this.configPath);
        this.config = { ...this.config, ...JSON.parse(retrievedConfig) };
      }
      logger.debug('Loaded config:', this.config);
    } catch (error) {
      throw new Error(`Error retrieving deployment context for stack ${this.stackKey}: ${error}`);
    }
  }

  /**
   * Resolves all secrets defined for this stack from AWS Secrets Manager.
   * Processes each secret, generates identifiers and paths, and retrieves values.
   *
   * @async
   * @returns {Promise<void>} Resolves when all secrets are processed and values retrieved
   * @throws {Error} If any secret is missing the required 'name' property or retrieval fails
   */
  async getSecrets() {
    for (const [key, secret] of Object.entries(this.secrets)) {
      if (secret.hasOwnProperty('name')) {
        secret.key = key;
        secret.id = this.createConstructId(secret);
        secret.path = this.createConstructSSMPath(secret.name);
        const value = await getSyncSecretFromSM(this, secret);
        secret.value = value || key;
      } else {
        throw new Error(`Secret ${key} is missing a 'name' property.`);
      }
    }
  }

  /**
   * Creates a CDK construct identifier using either strict naming or stack-prefixed naming.
   * If construct has strictName=true, uses the name as-is. Otherwise, prefixes with stack ID.
   *
   * @param {Object} construct - The construct configuration object
   * @param {string} construct.name - The base name of the construct
   * @param {boolean} [construct.strictName] - If true, use name without stack prefix
   * @returns {string} The CDK construct identifier
   */
  createConstructId(construct) {
    if (construct?.strictName) {
      return construct.name;
    }
    return this.stackId + '-' + construct.name.charAt(0).toUpperCase() + construct.name.slice(1);
  }

  /**
   * Creates a CloudFormation output path for a construct using app name, deployment, stack, and construct key.
   * Follows the pattern: {appName}-{deploymentName}-{stackKey}-{constructKey} with specified delimiter.
   *
   * @param {string} constructKey - The unique key identifier for the construct
   * @param {string} [delimiter='-'] - The delimiter to use between path components
   * @returns {string} The CloudFormation output path in camelCase format
   * @throws {Error} If any required path component is missing
   */
  createConstructCfnOutputPath(constructKey, delimiter = '-') {
    const parts = [this.getAppName(), this.getDeploymentName(), this.stackKey, constructKey];
    if (parts.some(part => !part)) {
      throw new Error(`Missing required parts to construct SSM path: ${JSON.stringify(parts)}`);
    }
    return parts.map(part => part.charAt(0).toLowerCase() + part.slice(1)).join(delimiter);
  }

  /**
   * Creates an AWS Systems Manager Parameter Store path for a construct.
   * Uses forward slashes as delimiters and prepends with '/' for SSM path format.
   *
   * @param {string} constructKey - The unique key identifier for the construct
   * @returns {string} The SSM parameter path (e.g., '/appName/deploymentName/stackKey/constructKey')
   */
  createConstructSSMPath(constructKey) {
    return '/' + this.createConstructCfnOutputPath(constructKey, '/');
  }

  /**
   * Retrieves the CloudFormation output path for a specific construct.
   *
   * @param {string} constructKey - The unique key identifier for the construct
   * @returns {string|undefined} The CloudFormation output path or undefined if construct not found
   */
  getCfnPath(constructKey) {
    return this.constructs?.[constructKey]?.cfnOutput;
  }

  /**
   * Creates a CloudFormation output for a construct with optional property specification.
   * Generates a CDK CfnOutput with export name and value for cross-stack references.
   *
   * @param {string} constructKey - The unique key identifier for the construct
   * @param {Object} construct - The construct instance or value to output
   * @param {string} [propertyName=''] - Optional property name to export from the construct
   * @returns {CfnOutput} The CloudFormation output instance
   */
  createCfnOutput(constructKey, construct, propertyName='') {
    // bind this to the stack context
    // get output id
    const constructPath = this.constructs?.[constructKey]?.cfnOutput;
    const outputId = `${constructPath}-cfnOutput` || `${constructKey}-cfnOutput`;

    return new CfnOutput(this, outputId, {
      value: propertyName ? construct[propertyName] : construct,
      exportName: propertyName ? `${constructPath}-${propertyName}` : construct.name,
    });
  }
}

module.exports = {
  StackPrimer,
};