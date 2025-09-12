/**
 * CDK resources for DynamoDB stream processing.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const lambdaEventSources = require('aws-cdk-lib/aws-lambda-event-sources');
const iam = require('aws-cdk-lib/aws-iam');


function streamSetup(scope, props) {
  console.log('DynamoDB Stream handlers setup...');

  // Stream processing function
  const streamFunction = new NodejsFunction(scope, 'StreamFunction', {
    code: lambda.Code.fromAsset('lib/handlers/dynamoStream'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    role: props.role,
  });

  // Allow the stream function to invoke API Gateway
  streamFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ['execute-api:Invoke', 'execute-api:ManageConnections'],
    resources: ['arn:aws:execute-api:*:*:*'],
  }));

  // Allow the stream function to query the reserve-rec-pubsub table
  streamFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ['dynamodb:Query', 'dynamodb:GetItem'],
    resources: [props.pubsubTable.tableArn],
  }));

  // Add DynamoDB stream processing policies to the function

  // Add the stream event source to the function
  /**
   * Only attach stream if the table was created by CDK (has proper stream configuration)
   * 
   * If tables are imported from Parameter Store, we skip stream attachment
   * since the streams should already be configured externally.
   */
  const shouldAttachStream = props.tablesCreatedByCDK !== false;
  
  if (shouldAttachStream) {
    console.log('Attaching DynamoDB stream event source (tables created by CDK)...');
    streamFunction.addEventSource(new lambdaEventSources.DynamoEventSource(
      props.mainTable,
      {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 10,
        bisectBatchOnError: true,
        retryAttempts: 3,
      }
    ));
  } else {
    console.log('Skipping DynamoDB stream attachment - using imported tables from Parameter Store');
  }

  return {
    streamFunction: streamFunction,
  };
}

module.exports = {
  streamSetup
};
