/**
 * CDK resources for DynamoDB stream processing.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const lambdaEventSources = require('aws-cdk-lib/aws-lambda-event-sources');
const iam = require('aws-cdk-lib/aws-iam');

class StreamResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    // Stream processing function
    const streamFunction = new NodejsFunction(this.scope, 'StreamFunction', {
      code: lambda.Code.fromAsset('lib/handlers/dynamoStream'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
      role: this.props.role,
    });

    // Allow the stream function to invoke API Gateway
    streamFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:Invoke', 'execute-api:ManageConnections'],
      resources: ['arn:aws:execute-api:*:*:*'],
    }));

    // Allow the stream function to query the reserve-rec-pubsub table
    streamFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:GetItem'],
      resources: [this.props.pubsubTable.tableArn],
    }));

    // Add DynamoDB stream processing policies to the function

    // Add the stream event source to the function
    streamFunction.addEventSource(new lambdaEventSources.DynamoEventSource(
      this.props.mainTable,
      {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 10,
        bisectBatchOnError: true,
        retryAttempts: 3,
      }
    ));
  }
}

module.exports = {
  StreamResources
};