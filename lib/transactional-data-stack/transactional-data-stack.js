
const { RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const iam = require('aws-cdk-lib/aws-iam');
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { DynamoStreamConstruct } = require('../../src/handlers/dynamoStream/constructs');
const { logger } = require('../helpers/utils');

const defaults = {
  description: 'Transactional Data stack managing DynamoDB tables, streams, and related resources for transactional data in the Reserve Recreation APIs."Transactional data" pertains to data that is frequently updated and changed (write-optimized), such as bookings and user interactions.',
  constructs: {
    transactionalDataTable: {
      name: 'TransactionalDataTable',
    },
    globalIdGsi: {
      name: 'GlobalIdGSI',
    },
    userSubGsi: {
      name: 'UserSubGSI',
    },
    dynamoStreamRole: {
      name: 'DynamoStreamRole',
    },
    dynamoStream: {
      name: 'DynamoStream',
    }
  },
  config: {
    refTableRemovalPolicyDestroy: 'true',
    refTableDeletionProtection: 'false',
    globalIdGsiPartitionKey: 'globalId',
    globalIdGsiSortKey: 'sk',
    userSubGsiPartitionKey: 'userSub',
    userSubGsiSortKey: 'sk',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  secrets: {},
};

async function createTransactionalDataStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new TransactionalDataStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Transactional Data Stack: ${error}`);
  }
}

class TransactionalDataStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);

    logger.info(`Creating Transactional Data Stack: ${this.stackId}`);

    // Create the Transactional Data DynamoDB Table
    this.transDataTable = null;
    if (this.overrides?.transactionalDataTableName) {
      logger.info(`Using overridden transactional data table name: ${this.overrides.transactionalDataTableName}`);
      this.transDataTable = dynamodb.Table.fromTableName(this, `${this.getConstructId('transactionalDataTable')}-Imported`, this.overrides.transactionalDataTableName);
    } else {
      this.transDataTable = new dynamodb.Table(this, this.getConstructId('transactionalDataTable'), {
        tableName: this.getConstructId('transactionalDataTable'),
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        deletionProtection: this.getConfigValue('transTableDeletionProtection') === 'true' ? true : false,
        removalPolicy: this.getConfigValue('transTableRemovalPolicyDestroy') === 'true' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      });
    }

    // Add Global Secondary Index (global ID)
    this.transDataTable.addGlobalSecondaryIndex({
      indexName: this.getConstructName('globalIdGsi'),
      partitionKey: { name: this.getConfigValue('globalIdGsiPartitionKey'), type: dynamodb.AttributeType.STRING },
      sortKey: { name: this.getConfigValue('globalIdGsiSortKey'), type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Add Global Secondary Index (User Sub)
    this.transDataTable.addGlobalSecondaryIndex({
      indexName: this.getConstructName('userSubGsi'),
      partitionKey: { name: this.getConfigValue('userSubGsiPartitionKey'), type: dynamodb.AttributeType.STRING },
      sortKey: { name: this.getConfigValue('userSubGsiSortKey'), type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

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
        this.getTransDataTableArn(),
        `${this.getTransDataTableArn()}/*`,
      ],
    });

    const dynamoStreamOpenSearchPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:ESHttp*',
      ],
      resources: [`${osDomainArn}/*`],
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
    this.dynamoStreamConstruct = new DynamoStreamConstruct(this, this.getConstructId('dynamoStream'), {
      table: this.transDataTable,
      handlerPrefix: 'transDataStream',
      tablesCreatedByCDK: true,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        OPENSEARCH_DOMAIN_ENDPOINT: osDomainUrl,
        TRANSACTIONAL_DATA_TABLE_NAME: this.getTransDataTableName(),
        OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: scope.resolveOpenSearchTransactionalDataIndexName(this),
      },
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      role: this.dynamoStreamRole,
    });

    // Export References
    // Transactional Data Table Name
    this.exportReference(this, 'transactionalDataTableName', this.getTransDataTableName(), `Name of the transactional data DynamoDB table in ${this.stackId}`);

    // Transactional Data Table ARN
    this.exportReference(this, 'transactionalDataTableArn', this.getTransDataTableArn(), `ARN of the transactional data DynamoDB table in ${this.stackId}`);

    scope.resolveTransDataTableName = this.getTransDataTableName.bind(this);
    scope.resolveTransDataTableArn = this.getTransDataTableArn.bind(this);
  }

  getTransDataTableName() {
    return this.transDataTable.tableName;
  }

  getTransDataTableArn() {
    return this.transDataTable.tableArn;
  }
}

module.exports = {
  createTransactionalDataStack,
};