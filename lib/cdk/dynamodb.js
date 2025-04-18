
/**
 * Builds the DynamoDB resources for the Reserve Rec CDK stack.
 */
const { CfnOutput } = require('aws-cdk-lib');
const { RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

function dynamodbSetup(scope, props) {
  console.log('Setting up DynamoDB resources...');

  // Main Reserve Rec Data Table
  const mainTable = new dynamodb.Table(scope, 'MainTable', {
    tableName: props.env.TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    pointInTimeRecovery: true,
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: RemovalPolicy.RETAIN
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

  // Outputs
  new CfnOutput(scope, 'MainTableName', {
    value: mainTable.tableName,
    description: 'Main Reserve Rec Data Table',
    exportName: 'MainTableName',
  });

  new CfnOutput(scope, 'AuditTableName', {
    value: auditTable.tableName,
    description: 'Audit Table',
    exportName: 'AuditTableName',
  });

  new CfnOutput(scope, 'PubSubTableName', {
    value: pubsubTable.tableName,
    description: 'PubSub Table',
    exportName: 'PubSubTableName',
  });

  return {
    mainTable: mainTable,
    auditTable: auditTable,
    pubsubTable: pubsubTable,
  };

}

module.exports = {
  dynamodbSetup
}


