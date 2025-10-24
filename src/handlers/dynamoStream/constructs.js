const { Construct } = require('constructs');
const lambda = require('aws-cdk-lib/aws-lambda');
const lambdaEventSources = require('aws-cdk-lib/aws-lambda-event-sources');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { logger } = require('../../../lib/helpers/utils');

class DynamoStreamConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    logger.info(`Creating Dynamo Stream Construct: ${constructId}`);

    if (!props?.refDataTable) {
      throw new Error('DynamoStreamConstruct requires a tableName property in props');
    }

    // Create the DynamoDB Stream processing Lambda function
    const streamFunctionId = scope.createScopedId(id, 'Function');
    this.streamFunction = new NodejsFunction(this, streamFunctionId, {
      functionName: streamFunctionId,
      description: props?.description || `DynamoDB Stream processor for ${scope.getAppName()} - ${scope.getDeploymentName()} environment`,
      code: lambda.Code.fromAsset('src/handlers/dynamoStream'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: props?.environment,
      role: props?.role,
      layers: props?.layers || [],
    });

    // Add the stream event source to the function
    /**
     * Only attach stream if the table was created by CDK (has proper stream configuration)
     *
     * If tables are imported from Parameter Store, we skip stream attachment
     * since the streams should already be configured externally.
     */
    const shouldAttachStream = props?.tablesCreatedByCDK !== false;

    if (shouldAttachStream) {
      logger.debug('Attaching DynamoDB stream event source (tables created by CDK)...');
      this.streamFunction.addEventSource(new lambdaEventSources.DynamoEventSource(
        props.refDataTable,
        {
          startingPosition: lambda.StartingPosition.TRIM_HORIZON,
          batchSize: 10,
          bisectBatchOnError: true,
          retryAttempts: 3,
        }
      ));
    } else {
      logger.debug('Skipping DynamoDB stream attachment - using imported tables from Parameter Store');
    }
  }
};

module.exports = {
  DynamoStreamConstruct,
};