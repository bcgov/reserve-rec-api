const { RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const { Key } = require('aws-cdk-lib/aws-kms');
const { logger, StackPrimer } = require("../utils");
const { BaseLayerConstruct, AwsUtilsLayerConstruct } = require("../../src/layers/constructs");
const { BaseStack } = require('../base-stack');

const defaults = {
  constructs: {
    baseLayer: {
      name: 'BaseLayer',
    },
    awsUtilsLayer: {
      name: 'AwsUtilsLayer',
    },
    kmsKey: {
      name: 'KmsKey',
    }
  },
  config: {
    defaultTimezone: 'America/Vancouver',
    logLevel: process.env.LOG_LEVEL || 'info',
    defaultRefDataTableName: 'ReserveRecApi-Local-ReferenceDataTable',
    kmsKeyRemovalPolicyDestroy: true,
    kmsKeyAlias: null
  }
};

async function createCoreStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new CoreStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Core Stack: ${error}`);
  }
}

class CoreStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Core Stack: ${this.stackId}`);

    // Create the Base Lambda Layer

    this.baseLayerConstruct = new BaseLayerConstruct(this, this.getConstructId('baseLayer'), {
      environment: {
        ...process.env,
        DEFAULT_TIMEZONE: this.getConfigValue('defaultTimezone'),
        LOG_LEVEL: this.getConfigValue('logLevel'),
      }
    });

    // Create the AWS Utils Lambda Layer
    this.awsUtilsLayerConstruct = new AwsUtilsLayerConstruct(this, this.getConstructId('awsUtilsLayer'), {
      environment: {
        ...process.env,
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TABLE_NAME: this.getConfigValue('defaultRefDataTableName'),
      }
    });

    // Create KMS Key
    if (this.getConfigValue('kmsKeyAlias')) {
      // A key already exists and we are just importing it.
      this.kmsKey = Key.fromLookup(this, this.getConstructId('kmsKey'), {
        aliasName: this.getConfigValue('kmsKeyAlias')  // Should be like 'alias/my-key'
      });
    } else {
      // Create a new key
      this.kmsKey = new Key(this, this.getConstructId('kmsKey'), {
        enableKeyRotation: true,
        alias: this.getConstructId('kmsKey'),
        description: `KMS Key for ${this.stackId}`,
        removalPolicy: this.getConfigValue('kmsKeyRemovalPolicyDestroy') ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      });

    }

    // Expose getters for other stacks to access resources
    scope.getBaseLayer = this.getBaseLayer.bind(this);
    scope.getAwsUtilsLayer = this.getAwsUtilsLayer.bind(this);
    scope.getKmsKey = this.getKmsKey.bind(this);
    // scope.getAdminRequestAuthorizer = this.getAdminRequestAuthorizer.bind(this);

    // Cfn Outputs
    new CfnOutput(this, `${this.getConstructId('baseLayer')}-cfnOutput`, {
      value: this.getBaseLayer().layerVersionArn,
      exportName: `${this.getCfnPath('baseLayer')}-layerVersionArn`
    });

    new CfnOutput(this, `${this.getConstructId('awsUtilsLayer')}-cfnOutput`, {
      value: this.getAwsUtilsLayer().layerVersionArn,
      exportName: `${this.getCfnPath('awsUtilsLayer')}-layerVersionArn`
    });

    new CfnOutput(this, `${this.getConstructId('kmsKey')}-cfnOutput`, {
      value: this.getKmsKey().keyArn,
      exportName: `${this.getCfnPath('kmsKey')}-keyArn`
    });
  }

  // Getters for resources

  getBaseLayer() {
    return this.baseLayerConstruct.getLayer();
  };

  getAwsUtilsLayer() {
    return this.awsUtilsLayerConstruct.getLayer();
  }

  getKmsKey() {
    return this.kmsKey;
  }

  getLogBucket() {
    return this.logBucket;
  }

}

module.exports = {
  createCoreStack
};