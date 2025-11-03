const { CfnOutput } = require('aws-cdk-lib');
const { logger } = require('./utils');
const { getParameterFromSSM, getSyncSecretFromSM } = require('./utils');

class StackPrimer {
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
    this.env = {
      account: scope.context.DEFAULT_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT || '000000000000',
      region: scope.context.DEFAULT_REGION || process.env.CDK_DEFAULT_REGION || 'ca-central-1'
    }
  }

  async prime() {
    this.nameConstructs();
    await this.getDeploymentConfig();
    await this.getSecrets(this.appScope);
  }

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


  async getSecrets() {
    for (const [key, secret] of Object.entries(this.secrets)) {
      if (secret.hasOwnProperty('name')) {
        secret.key = key;
        secret.id = this.createConstructId(secret);
        secret.path = this.createConstructSSMPath(key);
        const value = await getSyncSecretFromSM(this, secret);
        secret.value = value || key;
      } else {
        throw new Error(`Secret ${key} is missing a 'name' property.`);
      }
    }
  }

  createConstructId(construct) {
    if (construct?.strictName) {
      return construct.name;
    }
    return this.stackId + '-' + construct.name.charAt(0).toUpperCase() + construct.name.slice(1);
  }

  createConstructCfnOutputPath(constructKey, delimiter = '-') {
    const parts = [this.getAppName(), this.getDeploymentName(), this.stackKey, constructKey];
    if (parts.some(part => !part)) {
      throw new Error(`Missing required parts to construct SSM path: ${JSON.stringify(parts)}`);
    }
    return parts.map(part => part.charAt(0).toLowerCase() + part.slice(1)).join(delimiter);
  }

  createConstructSSMPath(constructKey) {
    return '/' + this.createConstructCfnOutputPath(constructKey, '/');
  }

  getCfnPath(constructKey) {
    return this.constructs?.[constructKey]?.cfnOutput;
  }

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