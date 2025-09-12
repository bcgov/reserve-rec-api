
/**
 * Builds the DynamoDB resources for the Reserve Rec CDK stack.
 */
const { CfnOutput } = require('aws-cdk-lib');
const { RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

function dynamodbSetup(scope, props) {
  console.log('Setting up DynamoDB resources...');

  /**
   * Main Reserve Rec Data Table - Simplified Approach
   *
   * Default behavior:
   * - Creates fresh tables via CDK
   * 
   * Optional table import (via CDK context):
   * - Specify existing table ARNs via --context flags
   * - Used for importing existing tables or point-in-time recovery scenarios
   */

  let mainTable;
  let auditTable;
  let pubsubTable;
  let tablesCreatedByCDK = false;

  // Use the stack name directly - it already includes environment suffix (e.g., LZAReserveRecCdkStack-dev)
  const stackName = process.env.STACK_NAME;
  
  console.log(`Setting up DynamoDB for stack: ${stackName}`);
  
  // Check if existing table ARNs are provided via CDK context
  // This allows importing existing tables without Parameter Store
  const existingMainTableArn = scope.node.tryGetContext('mainTableArn');
  const existingAuditTableArn = scope.node.tryGetContext('auditTableArn');
  const existingPubsubTableArn = scope.node.tryGetContext('pubsubTableArn');
  
  if (existingMainTableArn && existingAuditTableArn && existingPubsubTableArn) {
    console.log('Using existing tables from CDK context...');
    
    mainTable = dynamodb.Table.fromTableArn(scope, 'MainTable', existingMainTableArn);
    auditTable = dynamodb.Table.fromTableArn(scope, 'AuditTable', existingAuditTableArn);
    pubsubTable = dynamodb.Table.fromTableArn(scope, 'PubSubTable', existingPubsubTableArn);
    tablesCreatedByCDK = false;
    
  } else {
    console.log('Creating new tables via CDK...');
    
    ({ mainTable, auditTable, pubsubTable } = createTablesViaCDK(scope, props));
    tablesCreatedByCDK = true;
  }

  // Outputs
  new CfnOutput(scope, 'MainTableName', {
    value: mainTable.tableName,
    description: 'Main Reserve Rec Data Table',
    exportName: `MainTableName-${props.env.ENVIRONMENT}`,
  });

  new CfnOutput(scope, 'AuditTableName', {
    value: auditTable.tableName,
    description: 'Audit Table',
    exportName: `AuditTableName-${props.env.ENVIRONMENT}`,
  });

  new CfnOutput(scope, 'PubSubTableName', {
    value: pubsubTable.tableName,
    description: 'PubSub Table',
    exportName: `PubSubTableName-${props.env.ENVIRONMENT}`,
  });

  return {
    mainTable: mainTable,
    auditTable: auditTable,
    pubsubTable: pubsubTable,
    tablesCreatedByCDK: tablesCreatedByCDK
  };
}

/**
 * Helper function to create tables via CDK
 */
function createTablesViaCDK(scope, props) {
  let mainTable;

  mainTable = new dynamodb.Table(scope, 'MainTable', {
    tableName: props.env.TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    pointInTimeRecovery: true,
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: RemovalPolicy.RETAIN
  });

  // Add gsi1pk (UUID) as a GSI (removed for now)
  mainTable.addGlobalSecondaryIndex({
    indexName: 'globalId-index',
    partitionKey: { name: 'globalId', type: dynamodb.AttributeType.STRING },
    projectionType: dynamodb.ProjectionType.ALL,
  });
  
  // Add user (sub) on bookings as a GSI
  mainTable.addGlobalSecondaryIndex({
    indexName: 'bookingUserSub-index',
    partitionKey: { name: 'user', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    projectionType: dynamodb.ProjectionType.ALL,
  });
  
  // Audit Table
  const auditTable = new dynamodb.Table(scope, 'AuditTable', {
    tableName: props.env.AUDIT_TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    pointInTimeRecovery: true,
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: RemovalPolicy.RETAIN
  });

  // PubSub Table
  const pubsubTable = new dynamodb.Table(scope, 'PubSubTable', {
    tableName: props.env.PUBSUB_TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    pointInTimeRecovery: true,
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: RemovalPolicy.RETAIN
  });

  return { mainTable, auditTable, pubsubTable };
}

module.exports = {
  dynamodbSetup
}


