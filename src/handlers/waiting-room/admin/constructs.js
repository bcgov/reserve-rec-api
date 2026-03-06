'use strict';

const { LambdaConstruct } = require('../../../../lib/helpers/base-lambda');
const { NodejsFunction, LogLevel } = require('aws-cdk-lib/aws-lambda-nodejs');
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { Duration } = require('aws-cdk-lib');
const path = require('path');

const DEFAULT_NODE_RUNTIME = lambda.Runtime.NODEJS_20_X;

const defaults = {
  resources: {
    listQueuesFunction: { name: 'WrAdminListQueues' },
    createQueuesFunction: { name: 'WrAdminCreateQueues' },
    closeQueueFunction: { name: 'WrAdminCloseQueue' },
    deleteQueueFunction: { name: 'WrAdminDeleteQueue' },
    queueMetricsFunction: { name: 'WrAdminQueueMetrics' },
    toggleMode2Function: { name: 'WrAdminToggleMode2' },
    releaseMode2Function: { name: 'WrAdminReleaseMode2' },
  },
};

class AdminWaitingRoomConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, { ...props, defaults });

    const {
      waitingRoomTableName, waitingRoomTableArn, viewerFunctionName, releaseLambdaArn,
      wsManagementEndpoint,
    } = props;

    const handlerDir = path.join(__dirname);
    const sharedEnv = {
      ...this.resolveEnvironment(),
      WAITING_ROOM_TABLE_NAME: waitingRoomTableName,
      ...(wsManagementEndpoint ? { WEBSOCKET_MANAGEMENT_ENDPOINT: wsManagementEndpoint } : {}),
    };

    // Helper: create a NodejsFunction for a waiting-room admin handler
    const makeAdminFn = (resourceKey, filename, extraEnv = {}) => {
      const fnId = this.getResourceId(resourceKey);
      const fn = new NodejsFunction(scope, fnId, {
        runtime: DEFAULT_NODE_RUNTIME,
        entry: path.join(handlerDir, filename),
        handler: 'handler',
        bundling: { externalModules: ['aws-sdk', '/opt/*'], logLevel: LogLevel.ERROR },
        layers: this.resolveLayers(),
        environment: { ...sharedEnv, ...extraEnv },
        memorySize: 256,
        timeout: Duration.seconds(30),
        functionName: fnId,
      });
      // Grant DynamoDB access to waiting room table
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem',
          'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:BatchWriteItem',
        ],
        resources: [waitingRoomTableArn, `${waitingRoomTableArn}/index/*`],
      }));
      return fn;
    };

    // ── Lambda functions ────────────────────────────────────────────────────────

    this.listQueuesFunction = makeAdminFn('listQueuesFunction', 'list-queues.js');
    this.createQueuesFunction = makeAdminFn('createQueuesFunction', 'create-queues.js');

    this.closeQueueFunction = makeAdminFn('closeQueueFunction', 'close-queue.js');
    this.deleteQueueFunction = makeAdminFn('deleteQueueFunction', 'delete-queue.js');
    this.queueMetricsFunction = makeAdminFn('queueMetricsFunction', 'queue-metrics.js');

    this.toggleMode2Function = makeAdminFn('toggleMode2Function', 'toggle-mode2.js', {
      VIEWER_FUNCTION_NAME: viewerFunctionName || '',
    });

    // toggle-mode2 needs cloudfront:GetFunction/UpdateFunction/PublishFunction
    if (viewerFunctionName) {
      this.toggleMode2Function.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'cloudfront:GetFunction',
          'cloudfront:UpdateFunction',
          'cloudfront:PublishFunction',
        ],
        resources: ['*'], // CloudFront functions don't support resource-level ARN conditions
      }));
    }

    this.releaseMode2Function = makeAdminFn('releaseMode2Function', 'release-mode2.js', {
      RELEASE_LAMBDA_ARN: releaseLambdaArn || '',
    });

    // release-mode2 needs to invoke the Release Lambda
    if (releaseLambdaArn) {
      this.releaseMode2Function.addToRolePolicy(new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [releaseLambdaArn],
      }));
    }

    // ── API routes ──────────────────────────────────────────────────────────────
    const api = this.resolveApi();
    const authorizer = this.resolveAuthorizer();
    const authOptions = {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer,
    };

    // /waiting-room
    const wrResource = api.root.addResource('waiting-room');

    // /waiting-room/queues
    const queuesResource = wrResource.addResource('queues');
    queuesResource.addMethod('GET', new apigw.LambdaIntegration(this.listQueuesFunction), authOptions);
    queuesResource.addMethod('POST', new apigw.LambdaIntegration(this.createQueuesFunction), authOptions);

    // /waiting-room/queues/{queueId}
    const queueResource = queuesResource.addResource('{queueId}');
    queueResource.addMethod('DELETE', new apigw.LambdaIntegration(this.deleteQueueFunction), authOptions);

    // /waiting-room/queues/{queueId}/close
    const closeResource = queueResource.addResource('close');
    closeResource.addMethod('POST', new apigw.LambdaIntegration(this.closeQueueFunction), authOptions);

    // /waiting-room/queues/{queueId}/metrics
    const metricsResource = queueResource.addResource('metrics');
    metricsResource.addMethod('GET', new apigw.LambdaIntegration(this.queueMetricsFunction), authOptions);

    // /waiting-room/mode2
    const mode2Resource = wrResource.addResource('mode2');
    mode2Resource.addMethod('POST', new apigw.LambdaIntegration(this.toggleMode2Function), authOptions);

    // /waiting-room/mode2/release
    const mode2ReleaseResource = mode2Resource.addResource('release');
    mode2ReleaseResource.addMethod('POST', new apigw.LambdaIntegration(this.releaseMode2Function), authOptions);
  }
}

module.exports = { AdminWaitingRoomConstruct };
