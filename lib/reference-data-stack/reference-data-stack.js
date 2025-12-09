const { RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const iam = require('aws-cdk-lib/aws-iam');
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { DynamoStreamConstruct } = require('../../src/handlers/dynamoStream/constructs');
const { logger } = require('../helpers/utils');

const defaults = {
  description: 'Stack to manage DynamoDB tables, streams, and related resources for reference data storage and auditing. "Reference data" pertains static or semi-static data (read-optimized), such as facilities, activities, protected areas, and geozones.',
  constructs: {
    referenceDataTable: {
      name: 'ReferenceDataTable',
    },
    auditTable: {
      name: 'AuditTable',
    },
    pubsubTable: {
      name: 'PubSubTable',
    },
    globalIdGsi: {
      name: 'globalId-index',
    },
    userIdGsi: {
      name: 'userId-index',
    },
    dynamoStreamRole: {
      name: 'DynamoStreamRole',
    },
    dynamoStream: {
      name: 'RefDynamoStream',
    },
  },
  config: {
    refTableRemovalPolicyDestroy: 'true',
    refTableDeletionProtection: 'false',
    auditTableRemovalPolicyDestroy: 'true',
    auditTableDeletionProtection: 'false',
    pubsubTableRemovalPolicyDestroy: 'true',
    pubsubTableDeletionProtection: 'false',
    globalIdGsiPartitionKey: 'globalId',
    globalIdGsiSortKey: 'sk',
    userIdGsiPartitionKey: 'userId',
    userIdGsiSortKey: 'sk',
    logLevel: process.env.LOG_LEVEL || 'info',
    overrides: {
      referenceDataTableName: '',
      auditTableName: '',
      pubsubTableName: '',
    }
  },
  secrets: {}
};

class ReferenceDataStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Reference Data Stack: ${this.stackId}`);

    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);

    // Create reference data DynamoDB table (was: main-table)
    this.refDataTable = null;
    if (this.overrides?.referenceDataTableName) {
      logger.info(`Using overridden Reference Data Table Name: ${this.overrides.referenceDataTableName}`);
      this.refDataTable = dynamodb.Table.fromTableName(this, `${this.getConstructId('referenceDataTable')}-Imported`, this.overrides.referenceDataTableName);
    } else {
      this.refDataTable = new dynamodb.Table(this, this.getConstructId('referenceDataTable'), {
        tableName: this.getConstructId('referenceDataTable'),
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        pointInTimeRecoverySpecification: { enabled: true },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        deletionProtection: this.getConfigValue('refTableDeletionProtection') === 'true' ? true : false,
        removalPolicy: this.getConfigValue('refTableRemovalPolicyDestroy') === 'true' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
      });
    }

    // Add Global Secondary Index (Global ID)
    this.refDataTable.addGlobalSecondaryIndex({
      indexName: this.getConstructName('globalIdGsi'),
      partitionKey: { name: this.getConfigValue('globalIdGsiPartitionKey'), type: dynamodb.AttributeType.STRING },
      sortKey: { name: this.getConfigValue('globalIdGsiSortKey'), type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Add Global Secondary Index (User Sub)
    // TODO: Consider if this is needed on reference data table since transactional data will be in its own table in the Transactional Data Stack
    this.refDataTable.addGlobalSecondaryIndex({
      indexName: this.getConstructName('userIdGsi'),
      partitionKey: { name: this.getConfigValue('userIdGsiPartitionKey'), type: dynamodb.AttributeType.STRING },
      sortKey: { name: this.getConfigValue('userIdGsiSortKey'), type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create Audit Table (for logging changes to reference data)
    this.auditTable = null;
    if (this.overrides?.auditTableName) {
      logger.info(`Using overridden Audit Table Name: ${this.overrides.auditTableName}`);
      this.auditTable = dynamodb.Table.fromTableName(this, `${this.getConstructId('auditTable')}-Imported`, this.overrides.auditTableName);
    } else {
      this.auditTable = new dynamodb.Table(this, this.getConstructId('auditTable'), {
        tableName: this.getConstructId('auditTable'),
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        pointInTimeRecoverySpecification: { enabled: true },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        deletionProtection: this.getConfigValue('auditTableDeletionProtection') === 'true' ? true : false,
        removalPolicy: this.getConfigValue('auditTableRemovalPolicyDestroy') === 'true' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      });
    }

    // Create PubSub Table (for notifications)
    this.pubsubTable = null;
    if (this.overrides?.pubsubTableName) {
      logger.info(`Using overridden PubSub Table Name: ${this.overrides.pubsubTableName}`);
      this.pubsubTable = dynamodb.Table.fromTableName(this, `${this.getConstructId('pubsubTable')}-Imported`, this.overrides.pubsubTableName);
    } else {
      this.pubsubTable = new dynamodb.Table(this, this.getConstructId('pubsubTable'), {
        tableName: this.getConstructId('pubsubTable'),
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        pointInTimeRecoverySpecification: { enabled: true },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        deletionProtection: this.getConfigValue('pubsubTableDeletionProtection') === 'true' ? true : false,
        removalPolicy: this.getConfigValue('pubsubTableRemovalPolicyDestroy') === 'true' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      });
    }

    // OpenSearch Policy
    const osDomainArn = scope.resolveOpenSearchDomainArn(this);
    const osDomainEndpoint = scope.resolveOpenSearchDomainEndpoint(this);
    const osDomainUrl = `https://${osDomainEndpoint}`;

    // DynamoStream Policies for DynamoDB and OpenSearch
    const dynamoStreamDynamoDBPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:DeleteItem',
        'dynamodb:PutItem',
        'dynamodb:Scan',
        'dynamodb:Query',
        'dynamodb:UpdateItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:BatchGetItem',
        'dynamodb:DescribeTable',
        'dynamodb:ConditionCheckItem',
        'dynamodb:ListStreams',
        'dynamodb:DescribeStream',
        'dynamodb:ReadStreamRecords',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
      ],
      resources: [
        this.getRefDataTableArn(),
        `${this.getRefDataTableArn()}/*`,
        this.getAuditTableArn(),
        `${this.getAuditTableArn()}/*`
      ],
    });

    const dynamoStreamOpenSearchPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:ESHttp*',
      ],
      resources: [osDomainArn, `${osDomainArn}/*`],
    });


    // Create Stream Role
    this.dynamoStreamRole = new iam.Role(this, this.getConstructId('dynamoStreamRole'), {
      roleName: this.getConstructId('dynamoStreamRole'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        DynamoDBStreamPolicy: new iam.PolicyDocument({
          statements: [
            dynamoStreamDynamoDBPolicy,
            dynamoStreamOpenSearchPolicy,
          ]
        })
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaDynamoDBExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceFullAccess'),
      ],
    });

    // Setup DynamoDB Stream processing Lambda
    // this.dynamoStreamConstruct = new DynamoStreamConstruct(this, this.getConstructId('dynamoStream'), {
    //   table: this.refDataTable,
    //   handlerPrefix: 'refDataStream',
    //   tablesCreatedByCDK: true,
    //   environment: {
    //     LOG_LEVEL: this.getConfigValue('logLevel'),
    //     OPENSEARCH_DOMAIN_ENDPOINT: osDomainUrl,
    //     REFERENCE_DATA_TABLE_NAME: this.getRefDataTableName(),
    //     OPENSEARCH_REFERENCE_DATA_INDEX_NAME: scope.resolveOpenSearchReferenceDataIndexName(this),
    //     OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: scope.resolveOpenSearchTransactionalDataIndexName(this),
    //     AUDIT_TABLE_NAME: this.auditTable.tableName,
    //     PUBSUB_TABLE_NAME: this.pubsubTable.tableName,
    //   },
    //   layers: [
    //     baseLayer,
    //     awsUtilsLayer
    //   ],
    //   role: this.dynamoStreamRole,
    // });

    // Export References

    // Reference Data Table Name
    this.exportReference(this, 'referenceDataTableName', this.getRefDataTableName(), `Name of the Reference Data DynamoDB Table in ${this.stackId}`);

    // Reference Data
    this.exportReference(this, 'referenceDataTableArn', this.getRefDataTableArn(), `ARN of the Reference Data DynamoDB Table in ${this.stackId}`);

    // Audit Table Name
    this.exportReference(this, 'auditTableName', this.auditTable.tableName, `Name of the Audit DynamoDB Table in ${this.stackId}`);

    // Audit Table ARN
    this.exportReference(this, 'auditTableArn', this.getAuditTableArn(), `ARN of the Audit DynamoDB Table in ${this.stackId}`);

    // PubSub Table Name
    this.exportReference(this, 'pubsubTableName', this.pubsubTable.tableName, `Name of the PubSub DynamoDB Table in ${this.stackId}`);

    // PubSub Table ARN
    this.exportReference(this, 'pubsubTableArn', this.pubsubTable.tableArn, `ARN of the PubSub DynamoDB Table in ${this.stackId}`);

    // Bind resolvers to scope for other stacks to consume
    scope.resolveRefDataTableName = this.resolveRefDataTableName.bind(this);
    scope.resolveAuditTableName = this.resolveAuditTableName.bind(this);
    scope.resolvePubSubTableName = this.resolvePubSubTableName.bind(this);
    scope.resolveRefDataTableArn = this.resolveRefDataTableArn.bind(this);
    scope.resolveAuditTableArn = this.resolveAuditTableArn.bind(this);
    scope.resolvePubSubTableArn = this.resolvePubSubTableArn.bind(this);

  }

  getRefDataTable() {
    return this.refDataTable;
  }

  getRefDataTableName() {
    return this.refDataTable.tableName;
  }

  getRefDataTableArn() {
    return this.refDataTable.tableArn;
  }

  getAuditTableArn() {
    return this.auditTable.tableArn;
  }

  resolveRefDataTableName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('referenceDataTableName'));
  }

  resolveAuditTableName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('auditTableName'));
  }

  resolvePubSubTableName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('pubsubTableName'));
  }

  resolveRefDataTableArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('referenceDataTableArn'));
  }

  resolveAuditTableArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('auditTableArn'));
  }
  resolvePubSubTableArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('auditTableArn'));
  }

}

async function createReferenceDataStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new ReferenceDataStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Reference Data Stack: ${error}`);
  }
}

module.exports = {
  createReferenceDataStack,
};
