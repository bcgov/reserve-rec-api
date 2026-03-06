const cdk = require('aws-cdk-lib');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const secretsmanager = require('aws-cdk-lib/aws-secretsmanager');
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const iam = require('aws-cdk-lib/aws-iam');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
const apigwv2 = require('aws-cdk-lib/aws-apigatewayv2');
const { WebSocketLambdaIntegration } = require('aws-cdk-lib/aws-apigatewayv2-integrations');
const { WebSocketLambdaAuthorizer } = require('aws-cdk-lib/aws-apigatewayv2-authorizers');
const { BaseStack } = require('../helpers/base-stack');
const { StackPrimer } = require('../helpers/stack-primer');
const { logger } = require('../helpers/utils');
const path = require('path');

const DEFAULT_NODE_RUNTIME = lambda.Runtime.NODEJS_20_X;

const defaults = {
  constructs: {
    waitingRoomTable: {
      name: 'WaitingRoomTable',
    },
    hmacSigningKey: {
      name: 'HmacSigningKey',
    },
    wsAuthorizerLambda: {
      name: 'WsAuthorizer',
    },
    wsLambdaAuthorizer: {
      name: 'WsLambdaAuthorizer',
    },
    wsConnectLambda: {
      name: 'WsConnect',
    },
    wsConnectIntegration: {
      name: 'WsConnectIntegration',
    },
    wsDisconnectLambda: {
      name: 'WsDisconnect',
    },
    wsDisconnectIntegration: {
      name: 'WsDisconnectIntegration',
    },
    wsDefaultLambda: {
      name: 'WsDefault',
    },
    wsDefaultIntegration: {
      name: 'WsDefaultIntegration',
    },
    webSocketApi: {
      name: 'WaitingRoomWsApi',
    },
    webSocketStage: {
      name: 'WsStage',
    },
    randomizerLambda: {
      name: 'Randomizer',
    },
    releaseLambda: {
      name: 'Release',
    },
    cleanupLambda: {
      name: 'Cleanup',
    },
    queueMonitorLambda: {
      name: 'QueueMonitor',
    },
  },
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
    maxActiveSessions: 100,
    releaseBatchSize: 50,
    admissionTtlMinutes: 15,
    disconnectGracePeriodSeconds: 30,
    staleRandomizingTimeoutMinutes: 5,
    maxEntriesPerIp: 4,
    minAccountAgeHours: 0,
    publicUserPoolId: '',
    publicUserPoolClientId: '',
    inheritPublicUserPoolSettingsFromDeployment: 'true',
  },
  secrets: {},
  description: 'Waiting Room infrastructure — DynamoDB table, HMAC signing key, WebSocket API, and queue management Lambdas',
};

class WaitingRoomStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Waiting Room Stack: ${this.stackId}`);

    // -------------------------------------------------------------------------
    // DynamoDB — WaitingRoomTable
    // -------------------------------------------------------------------------
    this.waitingRoomTable = new dynamodb.Table(this, this.getConstructId('waitingRoomTable'), {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: this.isSandbox() ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // GSI: look up all queue entries for a specific Cognito user
    this.waitingRoomTable.addGlobalSecondaryIndex({
      indexName: 'cognitoSub-index',
      partitionKey: { name: 'cognitoSub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: count entries per IP within a queue
    this.waitingRoomTable.addGlobalSecondaryIndex({
      indexName: 'clientIp-index',
      partitionKey: { name: 'clientIp', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // -------------------------------------------------------------------------
    // Secrets Manager — HMAC signing key
    // -------------------------------------------------------------------------
    this.hmacSigningKey = new secretsmanager.Secret(this, this.getConstructId('hmacSigningKey'), {
      description: `HMAC-SHA256 signing key for waiting room admission tokens (${this.getDeploymentName()})`,
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    // Resolve Cognito user pool settings (same pattern as public-api-stack)
    if (this.getConfigValue('inheritPublicUserPoolSettingsFromDeployment') === 'true') {
      this.setConfigValue('publicUserPoolId', scope.resolvePublicUserPoolId(this));
      this.setConfigValue('publicUserPoolClientId', scope.resolvePublicUserPoolClientId(this));
    }

    // Resolve shared layers
    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);

    const sharedEnv = {
      LOG_LEVEL: this.getConfigValue('logLevel'),
      WAITING_ROOM_TABLE_NAME: this.waitingRoomTable.tableName,
      HMAC_SIGNING_KEY_ARN: this.hmacSigningKey.secretArn,
      MAX_ACTIVE_SESSIONS: String(this.getConfigValue('maxActiveSessions')),
      RELEASE_BATCH_SIZE: String(this.getConfigValue('releaseBatchSize')),
      ADMISSION_TTL_MINUTES: String(this.getConfigValue('admissionTtlMinutes')),
      DISCONNECT_GRACE_PERIOD_SECONDS: String(this.getConfigValue('disconnectGracePeriodSeconds')),
      STALE_RANDOMIZING_TIMEOUT_MINUTES: String(this.getConfigValue('staleRandomizingTimeoutMinutes')),
    };

    // -------------------------------------------------------------------------
    // WebSocket API Lambda handlers
    // -------------------------------------------------------------------------

    // Authorizer — validates Cognito JWT from ?token= query param on $connect
    this.wsAuthorizerLambda = new NodejsFunction(this, this.getConstructId('wsAuthorizerLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/websocket/authorizer.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        PUBLIC_USER_POOL_ID: this.getConfigValue('publicUserPoolId') || '',
        PUBLIC_USER_POOL_CLIENT_ID: this.getConfigValue('publicUserPoolClientId') || '',
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });

    // $connect handler — stores connectionId, handles single-connection enforcement
    this.wsConnectLambda = new NodejsFunction(this, this.getConstructId('wsConnectLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/websocket/connect.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        WAITING_ROOM_TABLE_NAME: this.waitingRoomTable.tableName,
        // WEBSOCKET_MANAGEMENT_ENDPOINT added after API is created
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });
    this.waitingRoomTable.grantReadWriteData(this.wsConnectLambda);

    // $disconnect handler — records disconnectedAt for grace period logic
    this.wsDisconnectLambda = new NodejsFunction(this, this.getConstructId('wsDisconnectLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/websocket/disconnect.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        WAITING_ROOM_TABLE_NAME: this.waitingRoomTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });
    this.waitingRoomTable.grantReadWriteData(this.wsDisconnectLambda);

    // $default handler — ping/pong and unmatched messages
    this.wsDefaultLambda = new NodejsFunction(this, this.getConstructId('wsDefaultLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/websocket/default.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    // -------------------------------------------------------------------------
    // API Gateway WebSocket API
    // -------------------------------------------------------------------------

    // Lambda authorizer — validates JWT on $connect, passes cognitoSub+queueId in context
    const wsLambdaAuthorizer = new WebSocketLambdaAuthorizer(
      this.getConstructId('wsLambdaAuthorizer'),
      this.wsAuthorizerLambda,
      {
        identitySource: ['route.request.querystring.token'],
      },
    );

    this.webSocketApi = new apigwv2.WebSocketApi(this, this.getConstructId('webSocketApi'), {
      apiName: this.getConstructId('webSocketApi'),
      description: `Waiting Room WebSocket API for ${this.getAppName()}-${this.getDeploymentName()}`,
      connectRouteOptions: {
        authorizer: wsLambdaAuthorizer,
        integration: new WebSocketLambdaIntegration(
          this.getConstructId('wsConnectIntegration'),
          this.wsConnectLambda,
        ),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          this.getConstructId('wsDisconnectIntegration'),
          this.wsDisconnectLambda,
        ),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          this.getConstructId('wsDefaultIntegration'),
          this.wsDefaultLambda,
        ),
      },
    });

    const wsStageName = 'ws';
    this.webSocketStage = new apigwv2.WebSocketStage(this, this.getConstructId('webSocketStage'), {
      webSocketApi: this.webSocketApi,
      stageName: wsStageName,
      autoDeploy: true,
    });

    // Management endpoint for postToConnection / deleteConnection
    const wsManagementEndpoint = this.webSocketStage.callbackUrl;

    // Patch connect Lambda with management endpoint now that stage is created
    this.wsConnectLambda.addEnvironment('WEBSOCKET_MANAGEMENT_ENDPOINT', wsManagementEndpoint);

    // Grant execute-api:ManageConnections to connect Lambda (for deleteConnection of old connections)
    this.wsConnectLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`],
    }));

    // -------------------------------------------------------------------------
    // Randomizer Lambda — triggered by EventBridge Scheduler at opening time
    // Also invokable by Queue Monitor as a safety net
    // -------------------------------------------------------------------------
    this.randomizerLambda = new NodejsFunction(this, this.getConstructId('randomizerLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/randomizer/handler.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: sharedEnv,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
    });
    this.waitingRoomTable.grantReadWriteData(this.randomizerLambda);

    // -------------------------------------------------------------------------
    // Release Lambda — invoked by Queue Monitor for each releasing queue
    // -------------------------------------------------------------------------
    this.releaseLambda = new NodejsFunction(this, this.getConstructId('releaseLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/release/handler.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        ...sharedEnv,
        WEBSOCKET_MANAGEMENT_ENDPOINT: wsManagementEndpoint,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
    });
    this.waitingRoomTable.grantReadWriteData(this.releaseLambda);
    this.hmacSigningKey.grantRead(this.releaseLambda);

    // Grant execute-api:ManageConnections to release Lambda (for postToConnection)
    this.releaseLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`],
    }));

    // -------------------------------------------------------------------------
    // Cleanup Lambda — EventBridge cron every 60 seconds
    // -------------------------------------------------------------------------
    this.cleanupLambda = new NodejsFunction(this, this.getConstructId('cleanupLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/cleanup/handler.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        ...sharedEnv,
        RELEASE_LAMBDA_ARN: this.releaseLambda.functionArn,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
    });
    this.waitingRoomTable.grantReadWriteData(this.cleanupLambda);
    // Cleanup needs to invoke Release Lambda to fill freed slots (P2-A)
    this.cleanupLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [this.releaseLambda.functionArn],
    }));

    // -------------------------------------------------------------------------
    // Queue Monitor Lambda — EventBridge cron every 60 seconds
    // Invokes Randomizer and Release Lambdas
    // -------------------------------------------------------------------------
    this.queueMonitorLambda = new NodejsFunction(this, this.getConstructId('queueMonitorLambda'), {
      entry: path.join(__dirname, '../../src/handlers/waiting-room/queue-monitor/handler.js'),
      handler: 'handler',
      runtime: DEFAULT_NODE_RUNTIME,
      bundling: { externalModules: ['aws-sdk', '/opt/*'] },
      layers: [baseLayer, awsUtilsLayer],
      environment: {
        ...sharedEnv,
        RANDOMIZER_LAMBDA_ARN: this.randomizerLambda.functionArn,
        RELEASE_LAMBDA_ARN: this.releaseLambda.functionArn,
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
    });
    this.waitingRoomTable.grantReadWriteData(this.queueMonitorLambda);

    // Queue Monitor needs to invoke Randomizer and Release Lambdas
    this.queueMonitorLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        this.randomizerLambda.functionArn,
        this.releaseLambda.functionArn,
      ],
    }));

    // -------------------------------------------------------------------------
    // EventBridge cron rules — every 1 minute
    // -------------------------------------------------------------------------
    new events.Rule(this, `${this.stackId}-CleanupCron`, {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(this.cleanupLambda)],
    });

    new events.Rule(this, `${this.stackId}-QueueMonitorCron`, {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(this.queueMonitorLambda)],
    });

    // -------------------------------------------------------------------------
    // Exports
    // -------------------------------------------------------------------------
    this.exportReference(
      this,
      'waitingRoomTableName',
      this.waitingRoomTable.tableName,
      `Name of the WaitingRoom DynamoDB table in ${this.stackId}`,
    );
    this.exportReference(
      this,
      'waitingRoomTableArn',
      this.waitingRoomTable.tableArn,
      `ARN of the WaitingRoom DynamoDB table in ${this.stackId}`,
    );
    this.exportReference(
      this,
      'hmacSigningKeyArn',
      this.hmacSigningKey.secretArn,
      `ARN of the HMAC signing key in Secrets Manager for ${this.stackId}`,
    );
    this.exportReference(
      this,
      'wsApiUrl',
      this.webSocketStage.url,
      `WebSocket API URL (wss://) for ${this.stackId}`,
    );
    this.exportReference(
      this,
      'wsManagementEndpoint',
      wsManagementEndpoint,
      `WebSocket management endpoint (https://) for ${this.stackId}`,
    );

    // Bind resolver functions so other stacks can consume these resources
    scope.resolveWaitingRoomTableName = this.getWaitingRoomTableName.bind(this);
    scope.resolveWaitingRoomTableArn = this.getWaitingRoomTableArn.bind(this);
    scope.resolveHmacSigningKeyArn = this.getHmacSigningKeyArn.bind(this);
    scope.getWaitingRoomTable = this.getWaitingRoomTable.bind(this);
    scope.getHmacSigningKey = this.getHmacSigningKey.bind(this);
    scope.resolveWsApiUrl = this.getWsApiUrl.bind(this);
    scope.resolveWsManagementEndpoint = this.getWsManagementEndpoint.bind(this);
    scope.resolveReleaseLambdaArn = this.getReleaseLambdaArn.bind(this);
  }

  getReleaseLambdaArn() {
    return this.releaseLambda.functionArn;
  }

  getWaitingRoomTable() {
    return this.waitingRoomTable;
  }

  getWaitingRoomTableName() {
    return this.waitingRoomTable.tableName;
  }

  getWaitingRoomTableArn() {
    return this.waitingRoomTable.tableArn;
  }

  getHmacSigningKey() {
    return this.hmacSigningKey;
  }

  getHmacSigningKeyArn() {
    return this.hmacSigningKey.secretArn;
  }

  getWsApiUrl() {
    return this.webSocketStage.url;
  }

  getWsManagementEndpoint() {
    return this.webSocketStage.callbackUrl;
  }
}

async function createWaitingRoomStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new WaitingRoomStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Waiting Room Stack: ${error}`);
  }
}

module.exports = {
  createWaitingRoomStack,
};
