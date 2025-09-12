
/**
 * Builds the DynamoDB resources for the Reserve Rec CDK stack.
 */
const { CfnOutput } = require('aws-cdk-lib');
const { RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const ssm = require('aws-cdk-lib/aws-ssm');

function dynamodbSetup(scope, props) {
  console.log('Setting up DynamoDB resources...');

  /**
   * Main Reserve Rec Data Table - Enhanced Parameter Store Approach
   *
   * This approach uses Parameter Store to manage table references, allowing for
   * flexible table adoption and management independent of the main CDK stack lifecycle.
   * 
   * Tables can be:
   * 1. Created fresh via CDK; or
   * 2. Referenced from Parameter Store where ARNs are stored by the TableManager
   */

  let mainTable;
  let auditTable;
  let pubsubTable;
  let tablesCreatedByCDK = false;

  // Use the stack name directly - it already includes environment suffix (e.g., LZAReserveRecCdkStack-dev)
  const stackName = process.env.STACK_NAME;
  
  console.log(`Setting up DynamoDB for stack: ${stackName}`);
  
  // Check if we should use Parameter Store (explicitly enabled) or create tables
  const useParameterStore = process.env.USE_PARAMETER_STORE === 'true';
  console.log(`Use Parameter Store: ${useParameterStore}`);
  
  // If not using Parameter Store, create tables via CDK
  if (!useParameterStore) {
    console.log('First deployment detected or forced table creation - creating tables via CDK...');
    ({ mainTable, auditTable, pubsubTable } = createTablesViaCDK(scope, props));
    tablesCreatedByCDK = true;
  } else {
    // Try to get table ARNs from Parameter Store for subsequent deployments
    try {
      const mainTableArn = getTableArnFromParameterStore(scope, 'main', stackName);
      const auditTableArn = getTableArnFromParameterStore(scope, 'audit', stackName);
      const pubsubTableArn = getTableArnFromParameterStore(scope, 'pubsub', stackName);

      if (mainTableArn && auditTableArn && pubsubTableArn) {
        console.log('Using tables from Parameter Store...');
        
        mainTable = dynamodb.Table.fromTableArn(scope, 'MainTable', mainTableArn);
        auditTable = dynamodb.Table.fromTableArn(scope, 'AuditTable', auditTableArn);
        pubsubTable = dynamodb.Table.fromTableArn(scope, 'PubSubTable', pubsubTableArn);
        tablesCreatedByCDK = false;
        
      } else {
        throw new Error('Not all table ARNs found in Parameter Store, falling back to creation');
      }
      
    } catch (error) {
      console.log('Parameter Store lookup failed, creating tables via CDK:', error.message);
      
      // Fallback to creating tables if Parameter Store lookup fails
      ({ mainTable, auditTable, pubsubTable } = createTablesViaCDK(scope, props));
      tablesCreatedByCDK = true;
    }
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
 * Helper function to get table ARN from Parameter Store
 */
function getTableArnFromParameterStore(scope, tableType, stackName) {
  // Parameter Store path strategy: /reserve-rec/{stackName}/tables/{tableType}/arn
  const parameterPath = `/reserve-rec/${stackName}/tables/${tableType}/arn`;
    
  console.log(`Looking up Parameter Store path: ${parameterPath}`);
  
  const parameter = ssm.StringParameter.fromStringParameterAttributes(scope, `${tableType}TableArnParameter`, {
    parameterName: parameterPath,
  });
  return parameter.stringValue;
}

/**
 * Helper function to get table ARN from Parameter Store
 */
function getTableArnFromParameterStore(scope, tableType, stackName) {
  // Parameter Store path strategy: /reserve-rec/{stackName}/tables/{tableType}/arn
  const parameterPath = `/reserve-rec/${stackName}/tables/${tableType}/arn`;
    
  console.log(`Looking up Parameter Store path: ${parameterPath}`);
  
  const parameter = ssm.StringParameter.fromStringParameterAttributes(scope, `${tableType}TableArnParameter`, {
    parameterName: parameterPath,
  });
  return parameter.stringValue;
}

/**
 * Helper function to create tables via CDK (fallback method)
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
