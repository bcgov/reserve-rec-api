const { RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const iam = require('aws-cdk-lib/aws-iam');
const { StackPrimer } = require('../utils');
const { BaseStack } = require('../base-stack');
const { DynamoStreamConstruct } = require('../../src/handlers/dynamoStream/constructs');
const { logger } = require('../utils');

const defaults = {
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
      name: 'GlobalIdIndex',
    },
    userSubGsi: {
      name: 'UserSubIndex',
    },
    dynamoStreamRole: {
      name: 'DynamoStreamRole',
    },
    dynamoStream: {
      name: 'DynamoStream',
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
    userSubGsiPartitionKey: 'userSub',
    userSubGsiSortKey: 'sk',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  secrets: {}
};

class ReferenceDataStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Reference Data Stack: ${this.stackId}`);

    // Create reference data DynamoDB table (was: main-table)
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

    // Add Global Secondary Index (Global ID)
    this.refDataTable.addGlobalSecondaryIndex({
      indexName: this.getConstructName('globalIdGsi'),
      partitionKey: { name: this.getConfigValue('globalIdGsiPartitionKey'), type: dynamodb.AttributeType.STRING },
      sortKey: { name: this.getConfigValue('globalIdGsiSortKey'), type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Add Global Secondary Index (User Sub)
    this.refDataTable.addGlobalSecondaryIndex({
      indexName: this.getConstructName('userSubGsi'),
      partitionKey: { name: this.getConfigValue('userSubGsiPartitionKey'), type: dynamodb.AttributeType.STRING },
      sortKey: { name: this.getConfigValue('userSubGsiSortKey'), type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Create Audit Table (for logging changes to reference data)
    this.auditTable = new dynamodb.Table(this, this.getConstructId('auditTable'), {
      tableName: this.getConstructId('auditTable'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: { enabled: true },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: this.getConfigValue('auditTableDeletionProtection') === 'true' ? true : false,
      removalPolicy: this.getConfigValue('auditTableRemovalPolicyDestroy') === 'true' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    });

    // Create PubSub Table (for notifications)
    this.pubsubTable = new dynamodb.Table(this, this.getConstructId('pubsubTable'), {
      tableName: this.getConstructId('pubsubTable'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecoverySpecification: { enabled: true },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: this.getConfigValue('pubsubTableDeletionProtection') === 'true' ? true : false,
      removalPolicy: this.getConfigValue('pubsubTableRemovalPolicyDestroy') === 'true' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    // Setup DynamoDB Stream processing Lambda
    this.dynamoStreamConstruct = new DynamoStreamConstruct(this, this.getConstructId('dynamoStream'), {
      refDataTable: this.refDataTable,
      tablesCreatedByCDK: true,
    });

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
      ],
    });

    // OpenSearch Policy
    const osDomainArn = scope.getOpenSearchDomainArn();
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



    // Expose getters for other stacks to access resources
    scope.getRefDataTableName = this.getRefDataTableName.bind(this);
    scope.getRefDataTableArn = this.getRefDataTableArn.bind(this);
    scope.getRefDataTable = this.getRefDataTable.bind(this);

    // Cfn Outputs
    new CfnOutput(this, `${this.getConstructId('referenceDataTable')}CfnOutput`, {
      value: this.getRefDataTable().tableName,
      exportName: `${this.getCfnPath('referenceDataTable')}-tableName`
    });

    new CfnOutput(this, `${this.getConstructId('auditTable')}CfnOutput`, {
      value: this.auditTable.tableName,
      exportName: `${this.getCfnPath('auditTable')}-tableName`
    });

    new CfnOutput(this, `${this.getConstructId('pubsubTable')}CfnOutput`, {
      value: this.pubsubTable.tableName,
      exportName: `${this.getCfnPath('pubsubTable')}-tableName`
    });

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