const cdk = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const logs = require('aws-cdk-lib/aws-logs');
const sqs = require('aws-cdk-lib/aws-sqs');
const iam = require('aws-cdk-lib/aws-iam');
const ssm = require('aws-cdk-lib/aws-ssm');
const { DynamoEventSource, SqsDlq } = require('aws-cdk-lib/aws-lambda-event-sources');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const apigwv2 = require('aws-cdk-lib/aws-apigatewayv2');
const { WebSocketLambdaIntegration } = require('aws-cdk-lib/aws-apigatewayv2-integrations');
const { WebSocketLambdaAuthorizer } = require('aws-cdk-lib/aws-apigatewayv2-authorizers');
const { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } = require('aws-cdk-lib/custom-resources');
const { BaseStack } = require('../helpers/base-stack');
const { StackPrimer } = require('../helpers/stack-primer');
const { addEventMetrics, eventMetricNamespace } = require('../helpers/event-metrics');
const { logger } = require('../helpers/utils');
const { TOPICS } = require('../../src/handlers/admin-realtime/topics');
const path = require('path');

const HANDLER_DIR = path.join(__dirname, '../../src/handlers/admin-realtime');
const ADMIN_REALTIME_STACK_KEY = 'adminRealtimeStack';

// Stream sources the publisher can consume, keyed by a topic's `source`. `table` reads each value through SSM
// (each resolver is called once: resolveReference adds a construct per path), so no export of the owning stack is imported.
const STREAM_SOURCES = {
  transactional: {
    importId: 'ImportedTransactionalDataTable',
    table: (scope, stack) => ({
      tableName: scope.resolveTransDataTableNameFromSsm(stack),
      tableArn: scope.resolveTransDataTableArnFromSsm(stack),
      tableStreamArn: scope.resolveTransDataTableStreamArn(stack),
    }),
    // The user row, and the user's bookings by the userId index — nothing else on the table
    wire: (fn, { tableName, tableArn }, scope) => {
      const userIdIndex = scope.resolveTransDataUserIdIndexName();
      fn.addEnvironment('TRANSACTIONAL_DATA_TABLE_NAME', tableName);
      fn.addEnvironment('USERID_INDEX_NAME', userIdIndex);
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [tableArn] }));
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${tableArn}/index/${userIdIndex}`] }));
    },
  },
};

// source name -> the topics that read it; topics with source null publish directly and need no stream
function topicsBySource(topics, streamSources) {
  const bySource = {};
  for (const [name, topic] of Object.entries(topics)) {
    if (topic.source === null) continue;
    if (!streamSources[topic.source]) {
      throw Object.assign(new Error(`topic "${name}" has unknown source "${topic.source}"`), { fatal: true });
    }
    (bySource[topic.source] ||= []).push(topic);
  }
  return bySource;
}

const defaults = {
  constructs: {
    adminRealtimeTable: { name: 'AdminRealtimeTable' },
    publisherFailureQueue: { name: 'PublisherFailureQueue' },
    authorizerLambda: { name: 'Authorizer' },
    wsLambdaAuthorizer: { name: 'WsLambdaAuthorizer' },
    connectLambda: { name: 'Connect' },
    disconnectLambda: { name: 'Disconnect' },
    subscribeLambda: { name: 'Subscribe' },
    unsubscribeLambda: { name: 'Unsubscribe' },
    pingLambda: { name: 'Ping' },
    defaultLambda: { name: 'Default' },
    publisherLambda: { name: 'Publisher' },
    webSocketApi: { name: 'AdminRealtimeWsApi' },
    webSocketStage: { name: 'WsStage' },
    adminConfigWebSocketUrl: { name: 'AdminConfigWebSocketUrl' },
  },
  config: {
    logLevel: 'info',
    publisherBatchSize: 10,
    publisherRetryAttempts: 3,
    realtimeStaffAddedEnabled: 'false',
    stageRateLimit: 20,
    stageBurstLimit: 50,
    connectRateLimit: 200,
    connectBurstLimit: 400,
    inheritAdminUserPoolSettingsFromDeployment: 'true',
    adminUserPoolId: '',
    adminUserPoolClientId: '',
  },
  secrets: {},
  description: 'Admin realtime infrastructure — admin-only WebSocket API, connection table, and the transactional-stream publisher',
};

class AdminRealtimeStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Admin Realtime Stack: ${this.stackId}`);

    this.adminRealtimeTable = new dynamodb.Table(this, this.getConstructId('adminRealtimeTable'), {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: this.isSandbox() ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    if (this.getConfigValue('inheritAdminUserPoolSettingsFromDeployment') === 'true') {
      this.setConfigValue('adminUserPoolId', scope.resolveAdminUserPoolId(this));
      this.setConfigValue('adminUserPoolClientId', scope.resolveAdminUserPoolClientId(this));
    }

    const layers = [scope.resolveBaseLayer(this), scope.resolveAwsUtilsLayer(this)];
    const staffAddedEnabled = String(this.getConfigValue('realtimeStaffAddedEnabled')) === 'true';
    const staffAddedEnv = { REALTIME_STAFF_ADDED_ENABLED: String(staffAddedEnabled) };
    const logLevel = this.getConfigValue('logLevel');
    const tableEnv = {
      LOG_LEVEL: logLevel,
      ADMIN_REALTIME_TABLE_NAME: this.adminRealtimeTable.tableName,
    };

    const fn = (constructKey, file, environment, props = {}) => new NodejsFunction(this, this.getConstructId(constructKey), {
      functionName: this.getConstructId(constructKey).slice(0, 64),
      entry: path.join(HANDLER_DIR, file),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers,
      environment,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logRetention: logs.RetentionDays.TWO_YEARS,
      ...props,
    });

    // Authorizer — reads the user's permission record the same way the admin REST authorizer does
    const refDataTableArn = scope.resolveRefDataTableArn(this);
    const refDataTableName = scope.resolveRefDataTableName(this);
    this.authorizerLambda = fn('authorizerLambda', 'authorizer.js', {
      LOG_LEVEL: logLevel,
      ADMIN_USER_POOL_ID: this.getConfigValue('adminUserPoolId') || '',
      ADMIN_USER_POOL_CLIENT_ID: this.getConfigValue('adminUserPoolClientId') || '',
      REFERENCE_DATA_TABLE_NAME: refDataTableName,
      ...staffAddedEnv,
    });
    this.authorizerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [refDataTableArn],
    }));

    this.connectLambda = fn('connectLambda', 'connect.js', tableEnv);
    this.disconnectLambda = fn('disconnectLambda', 'disconnect.js', tableEnv);
    this.subscribeLambda = fn('subscribeLambda', 'subscribe.js', { ...tableEnv, ...staffAddedEnv });
    this.unsubscribeLambda = fn('unsubscribeLambda', 'unsubscribe.js', tableEnv);
    this.pingLambda = fn('pingLambda', 'ping.js', tableEnv);
    this.defaultLambda = fn('defaultLambda', 'default.js', tableEnv);
    // ping and $default touch no table.
    this.adminRealtimeTable.grant(this.connectLambda, 'dynamodb:PutItem');
    this.adminRealtimeTable.grant(this.disconnectLambda, 'dynamodb:DeleteItem');
    this.adminRealtimeTable.grant(this.subscribeLambda, 'dynamodb:GetItem', 'dynamodb:PutItem');
    this.adminRealtimeTable.grant(this.unsubscribeLambda, 'dynamodb:DeleteItem');

    const integration = (constructKey, handler) => new WebSocketLambdaIntegration(`${this.getConstructId(constructKey)}-Integration`, handler);

    this.webSocketApi = new apigwv2.WebSocketApi(this, this.getConstructId('webSocketApi'), {
      apiName: this.getConstructId('webSocketApi'),
      description: `Admin realtime WebSocket API for ${this.getAppName()}-${this.getDeploymentName()}`,
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: {
        authorizer: new WebSocketLambdaAuthorizer(this.getConstructId('wsLambdaAuthorizer'), this.authorizerLambda, {
          identitySource: ['route.request.querystring.token'],
        }),
        integration: integration('connectLambda', this.connectLambda),
      },
      disconnectRouteOptions: {
        integration: integration('disconnectLambda', this.disconnectLambda),
      },
      // returnResponse sends the handler's body back to the caller as the control reply
      defaultRouteOptions: {
        integration: integration('defaultLambda', this.defaultLambda),
        returnResponse: true,
      },
    });
    for (const [routeKey, constructKey, handler] of [
      ['subscribe', 'subscribeLambda', this.subscribeLambda],
      ['unsubscribe', 'unsubscribeLambda', this.unsubscribeLambda],
      ['ping', 'pingLambda', this.pingLambda],
    ]) {
      this.webSocketApi.addRoute(routeKey, { integration: integration(constructKey, handler), returnResponse: true });
    }

    this.webSocketStage = new apigwv2.WebSocketStage(this, this.getConstructId('webSocketStage'), {
      webSocketApi: this.webSocketApi,
      stageName: 'ws',
      autoDeploy: true,
      throttle: {
        rateLimit: Number(this.getConfigValue('stageRateLimit')),
        burstLimit: Number(this.getConfigValue('stageBurstLimit')),
      },
    });
    // RouteSettings names $connect, so the stage must wait for the routes or CreateStage can fail.
    this.webSocketStage.node.addDependency(this.webSocketApi);
    // $connect gets its own, higher limit so a tokenless flood eats less of the budget legitimate reconnects need.
    // RouteSettings is untyped JSON in CfnStage, so the keys are written in CloudFormation case.
    this.webSocketStage.node.defaultChild.routeSettings = {
      $connect: {
        ThrottlingRateLimit: Number(this.getConfigValue('connectRateLimit')),
        ThrottlingBurstLimit: Number(this.getConfigValue('connectBurstLimit')),
      },
    };

    // Publisher — one stream consumer per source that a topic reads
    const bySource = topicsBySource(TOPICS, STREAM_SOURCES);

    this.publisherFailureQueue = new sqs.Queue(this, this.getConstructId('publisherFailureQueue'), {
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    this.publisherLambda = fn('publisherLambda', 'publisher.js', {
      LOG_LEVEL: logLevel,
      ...staffAddedEnv,
    }, { timeout: cdk.Duration.seconds(30) });
    this.grantRealtimePublish(this.publisherLambda);

    // table name -> source, so the publisher can route each stream record by the table it came from
    const sourceByTable = {};
    for (const [source, topics] of Object.entries(bySource)) {
      const streamSource = STREAM_SOURCES[source];
      const refs = streamSource.table(scope, this);
      sourceByTable[refs.tableName] = source;
      const table = dynamodb.Table.fromTableAttributes(this, `${this.stackId}-${streamSource.importId}`, {
        tableArn: refs.tableArn,
        tableStreamArn: refs.tableStreamArn,
      });
      streamSource.wire(this.publisherLambda, refs, scope);
      this.publisherLambda.addEventSource(new DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: Number(this.getConfigValue('publisherBatchSize')),
        retryAttempts: Number(this.getConfigValue('publisherRetryAttempts')),
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        onFailure: new SqsDlq(this.publisherFailureQueue),
        filters: topics
          .flatMap((topic) => topic.filters({ staffAddedEnabled }))
          .map((pattern) => lambda.FilterCriteria.filter(pattern)),
      }));
    }
    this.publisherLambda.addEnvironment('REALTIME_SOURCES', this.toJsonString(sourceByTable));

    const metricNamespace = eventMetricNamespace(this.getDeploymentName());
    addEventMetrics(this.connectLambda, metricNamespace, ['realtime_connected']);
    addEventMetrics(this.disconnectLambda, metricNamespace, ['realtime_disconnected']);
    addEventMetrics(this.subscribeLambda, metricNamespace, ['realtime_subscribe_forbidden']);
    addEventMetrics(this.publisherLambda, metricNamespace, ['realtime_message_sent', 'realtime_publish_failed', 'realtime_send_failed']);

    // Keeps WEBSOCKET_URL on the admin config record in step with the stage; the physical id stays
    // constant so a URL change is an update, not a replacement whose delete would remove the new value.
    const adminConfigUpdate = (expression, values) => ({
      service: 'DynamoDB',
      action: 'UpdateItem',
      parameters: {
        TableName: refDataTableName,
        Key: { pk: { S: 'config' }, sk: { S: 'admin' } },
        UpdateExpression: expression,
        ...(values && { ExpressionAttributeValues: values }),
      },
      physicalResourceId: PhysicalResourceId.of('config-admin-WEBSOCKET_URL'),
    });
    const setUrl = adminConfigUpdate('SET WEBSOCKET_URL = :url', { ':url': { S: this.webSocketStage.url } });
    new AwsCustomResource(this, this.getConstructId('adminConfigWebSocketUrl'), {
      onCreate: setUrl,
      onUpdate: setUrl,
      onDelete: adminConfigUpdate('REMOVE WEBSOCKET_URL'),
      installLatestAwsSdk: false,
      policy: AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
        actions: ['dynamodb:UpdateItem'],
        resources: [refDataTableArn],
        // Null guards ForAllValues, which passes when the key is absent; ReturnValues stops a write returning the whole item.
        conditions: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': ['config'],
            'dynamodb:Attributes': ['pk', 'sk', 'WEBSOCKET_URL'],
          },
          Null: { 'dynamodb:LeadingKeys': 'false', 'dynamodb:Attributes': 'false' },
          StringEqualsIfExists: { 'dynamodb:ReturnValues': ['NONE'] },
        },
      })]),
    });

    this.exportReference(this, 'wsApiUrl', this.webSocketStage.url, `Admin realtime WebSocket URL (wss://) for ${this.stackId}`);
    this.exportReference(this, 'wsManagementEndpoint', this.webSocketStage.callbackUrl, `Admin realtime WebSocket management endpoint (https://) for ${this.stackId}`);
    this.exportReference(this, 'wsApiId', this.webSocketApi.apiId, `Admin realtime WebSocket API id for ${this.stackId}`);
    this.exportReference(this, 'adminRealtimeTableName', this.adminRealtimeTable.tableName, `Name of the AdminRealtime DynamoDB table in ${this.stackId}`);
    this.exportReference(this, 'adminRealtimeTableArn', this.adminRealtimeTable.tableArn, `ARN of the AdminRealtime DynamoDB table in ${this.stackId}`);
  }

  // What a Lambda in this stack needs to call publish(): post to and drop connections, and read/clean the connection table.
  grantRealtimePublish(fn) {
    this.webSocketStage.grantManagementApiAccess(fn);
    this.adminRealtimeTable.grant(fn, 'dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:DeleteItem');
    fn.addEnvironment('ADMIN_REALTIME_TABLE_NAME', this.adminRealtimeTable.tableName);
    fn.addEnvironment('WEBSOCKET_MANAGEMENT_ENDPOINT', this.webSocketStage.callbackUrl);
  }
}

/**
 * The same grant for a Lambda in any other BaseStack, read from AdminRealtimeStack's SSM exports by path, so it
 * works from stacks built before that one. The calling stack needs dep(<it>, adminRealtimeStack) in bin/app.js.
 */
function grantRealtimePublish(fn) {
  const consumer = cdk.Stack.of(fn);
  const realtime = new StackPrimer(consumer.appScope, ADMIN_REALTIME_STACK_KEY);
  // Plain SSM reads rather than resolveReference: its trigger tag imports the owning stack's NoOp provider ARN, an export.
  const ref = (key) => ssm.StringParameter.valueForStringParameter(consumer, realtime.createConstructSSMPath(key));
  fn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['execute-api:ManageConnections'],
    resources: [`arn:${cdk.Aws.PARTITION}:execute-api:${consumer.region}:${consumer.account}:${ref('wsApiId')}/ws/*/@connections/*`],
  }));
  fn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:DeleteItem'],
    resources: [ref('adminRealtimeTableArn')],
  }));
  fn.addEnvironment('ADMIN_REALTIME_TABLE_NAME', ref('adminRealtimeTableName'));
  fn.addEnvironment('WEBSOCKET_MANAGEMENT_ENDPOINT', ref('wsManagementEndpoint'));
}

async function createAdminRealtimeStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new AdminRealtimeStack(scope, primer);
  } catch (error) {
    throw Object.assign(new Error(`Error creating Admin Realtime Stack: ${error}`), { fatal: error.fatal });
  }
}

module.exports = {
  ADMIN_REALTIME_STACK_KEY,
  createAdminRealtimeStack,
  grantRealtimePublish,
  STREAM_SOURCES,
};
