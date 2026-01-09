const { RemovalPolicy } = require('aws-cdk-lib');
const { Key } = require('aws-cdk-lib/aws-kms');
const { StackPrimer } = require("../helpers/stack-primer");
const { logger } = require("../helpers/utils");
const { BaseLayerConstruct, AwsUtilsLayerConstruct } = require("../../src/layers/constructs");
const { BaseStack } = require('../helpers/base-stack');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigw = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');

const defaults = {
  description: 'Core stack providing critical and shared resources such as Lambda layers, KMS key, and API Gateway logging role for the Reserve Recreation APIs.',
  constructs: {
    baseLayer: {
      name: 'BaseLayer',
    },
    awsUtilsLayer: {
      name: 'AwsUtilsLayer',
    },
    kmsKey: {
      name: 'KmsKey',
    },
    adminApiLoggingRole: {
      name: 'AdminApiLoggingRole',
    },
    apiLoggingAccount: {
      name: 'ApiLoggingAccount',
    }
  },
  config: {
    defaultTimezone: 'America/Vancouver',
    logLevel: process.env.LOG_LEVEL || 'info',
    defaultRefDataTableName: 'ReserveRecApi-Local-ReferenceDataTable',
    defaultAuditTableName: 'ReserveRecApi-Local-AuditTable',
    kmsKeyRemovalPolicyDestroy: true,
    kmsKeyAlias: null,
    opensearchAuditIndexName: 'audit-index',
    opensearchTransactionalDataIndexName: 'transactional-data-index',
    opensearchDomainEndpoint: '',
    opensearchReferenceDataIndexName: 'reference-data-index',
    publicDomainNameSSMPath: `/reserveRecPublic/dev/distributionStack/distributionDomainName`,
    adminDomainNameSSMPath: `/reserveRecAdmin/dev/distributionStack/distributionDomainName`,
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
        REFERENCE_DATA_TABLE_NAME: this.getConfigValue('defaultRefDataTableName'),
        AUDIT_TABLE_NAME: this.getConfigValue('defaultAuditTableName'),
        OPENSEARCH_AUDIT_INDEX_NAME: this.getConfigValue('opensearchAuditIndexName') || 'audit-index',
        OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: this.getConfigValue('opensearchBookingIndexName') || 'booking-index',
        OPENSEARCH_DOMAIN_ENDPOINT: this.getConfigValue('opensearchDomainEndpoint'),
        OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.getConfigValue('opensearchReferenceDataIndexName') || 'reference-data-index',
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

    // Create API logging role
    this.apiLoggingRole = new iam.Role(this, this.getConstructId('adminApiLoggingRole'), {
      roleName: this.getConstructId('adminApiLoggingRole'),
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
      ]
    });

    // Register the role for API Gateway logging
    new apigw.CfnAccount(this, this.getConstructId('apiLoggingAccount'), {
      cloudWatchRoleArn: this.apiLoggingRole.roleArn
    });

    // Export References

    // Base Layer ARN
    this.exportReference(this, 'baseLayerArn', this.baseLayerConstruct.getLayer().layerVersionArn, `ARN of the Base Lambda Layer in ${this.stackId}`);

    // AWS Utils Layer ARN
    this.exportReference(this, 'awsUtilsLayerArn', this.awsUtilsLayerConstruct.getLayer().layerVersionArn, `ARN of the AWS Utils Lambda Layer in ${this.stackId}`);

    // KMS Key ARN
    this.exportReference(this, 'kmsKeyArn', this.kmsKey.keyArn, `ARN of the KMS Key in ${this.stackId}`);

    // OpenSearch Reference Data Index Name
    this.exportReference(this, 'opensearchReferenceDataIndexName', this.getConfigValue('opensearchReferenceDataIndexName'), `Name of the OpenSearch Reference Data Index in ${this.stackId}`);

    // OpenSearch Booking Index Name
    this.exportReference(this, 'opensearchTransactionalDataIndexName', this.getConfigValue('opensearchTransactionalDataIndexName'), `Name of the OpenSearch Transactional Data Index in ${this.stackId}`);

    // Bind resolve functions to scope for other stacks to consume
    scope.resolveBaseLayer = this.resolveBaseLayer.bind(this);
    scope.resolveAwsUtilsLayer = this.resolveAwsUtilsLayer.bind(this);
    scope.resolveKmsKey = this.resolveKmsKey.bind(this);
    scope.resolveOpenSearchReferenceDataIndexName = this.resolveOpenSearchReferenceDataIndexName.bind(this);
    scope.resolveOpenSearchTransactionalDataIndexName = this.resolveOpenSearchTransactionalDataIndexName.bind(this);
    scope.resolveAdminDomainName = this.resolveAdminDomainName.bind(this);
    scope.resolvePublicDomainName = this.resolvePublicDomainName.bind(this);
  }

  resolveBaseLayer(consumerScope) {
    // Get SSM Value for baseLayerArn
    const layerArn = this.resolveReference(consumerScope, this.getExportSSMPath('baseLayerArn'));


    // Create baseLayer from import
    const baseLayer = lambda.LayerVersion.fromLayerVersionArn(consumerScope, `${this.getConstructId('baseLayer')}-imported`, layerArn);

    return baseLayer;
  }

  resolveAwsUtilsLayer(consumerScope) {
    // Get SSM Value for awsUtilsLayerArn
    const layerArn = this.resolveReference(consumerScope, this.getExportSSMPath('awsUtilsLayerArn'));

    // Create awsUtilsLayer from import
    const awsUtilsLayer = lambda.LayerVersion.fromLayerVersionArn(consumerScope, `${this.getConstructId('awsUtilsLayer')}-imported`, layerArn);

    return awsUtilsLayer;
  }

  resolveKmsKey(consumerScope) {
    // Get SSM Value for kmsKeyArn
    const keyArn = this.resolveReference(consumerScope, this.getExportSSMPath('kmsKeyArn'));

    // Create kmsKey from import
    const kmsKey = Key.fromKeyArn(consumerScope, `${this.getConstructId('kmsKey')}-imported`, keyArn);


    return kmsKey;
  }

  resolveOpenSearchReferenceDataIndexName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('opensearchReferenceDataIndexName'));
  }

  resolveOpenSearchTransactionalDataIndexName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('opensearchTransactionalDataIndexName'));
  }

  // Gets the Domain for the admin site from SSM
  resolveAdminDomainName(consumerScope) {
    return this.resolveReference(consumerScope, this.getConfigValue('adminDomainNameSSMPath'));
  }

  // Gets the Domain for the public site from SSM
  resolvePublicDomainName(consumerScope) {
    return this.resolveReference(consumerScope, this.getConfigValue('publicDomainNameSSMPath'));
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

}

module.exports = {
  createCoreStack
};