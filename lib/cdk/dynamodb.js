
/**
 * Builds the DynamoDB resources for the Reserve Rec CDK stack.
 */
const { CfnOutput } = require('aws-cdk-lib');
const { RemovalPolicy } = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

function dynamodbSetup(scope, props) {
  console.log('Setting up DynamoDB resources...');

  /**
   * Main Reserve Rec Data Table
   *
   * 2025-05-20 - The main table has been orphaned and recreated from a PITR backup. As such, the references to the main table
   * have been severed, causing deployment issues, as the new table is not the one created by the CDK stack instructions.
   *
   * As a temporary fix, the main table is being referenced by its ARN. This will hopefully unblock the deployment process. Unfortunately,
   * this means that the CDK stack will not be able to manage the table, and any changes to the table will need to be done manually.
   *
   * The proper way to adopt newly created resources into a CDK stack is to use the `cdk import` command. However, this is not possible in this case,
   * as the developer's local environment variables are not synced up with the remote AWS account, and merging these changes is not a favourable
   * option for quick turnaround. In the future, we should look to adopt this approach as recommended by AWS.
   *
   * https://aws.amazon.com/blogs/database/use-point-in-time-recovery-to-restore-an-amazon-dynamodb-table-managed-by-aws-cdk/
   *
   * The constructs affected by this change are the main table and the stream function that is triggered by the main table. They have been commented out.
   *
   * Emphasis on the fact that this is a temporary fix. The main table should be managed by the CDK stack.
   */

  const mainTable = dynamodb.Table.fromTableArn(scope, 'MainTable', 'arn:aws:dynamodb:ca-central-1:637423314715:table/reserve-rec-main');

  // Main Reserve Rec Data Table
  // const mainTable = new dynamodb.Table(scope, 'MainTable', {
  //   tableName: props.env.TABLE_NAME,
  //   partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
  //   sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
  //   pointInTimeRecovery: true,
  //   billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  //   stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
  //   removalPolicy: RemovalPolicy.RETAIN
  // });

  // Add gsi1pk (UUID) as a GSI
  mainTable.addGlobalSecondaryIndex({
    indexName: 'globalId-index',
    partitionKey: { name: 'globalId', type: dynamodb.AttributeType.STRING },
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

  // Counter Table
  const counterTable = new dynamodb.Table(scope, 'CounterTable', {
    tableName: props.env.COUNTER_TABLE_NAME,
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
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

  new CfnOutput(scope, 'CounterTableName', {
    value: counterTable.tableName,
    description: 'Counter Table',
    exportName: 'CounterTableName',
  });

  return {
    mainTable: mainTable,
    auditTable: auditTable,
    pubsubTable: pubsubTable,
    counterTable: counterTable
  };

}

module.exports = {
  dynamodbSetup
}


