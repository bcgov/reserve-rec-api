'use strict';

const path = require('path');
const { App, Stack } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const lambda = require('aws-cdk-lib/aws-lambda');

const HANDLER_DIR = path.join(__dirname, '../../src/handlers/admin-realtime');

// The patterns topics.js must produce; bookingCompletionTime is a number on the stream image.
const USER_INSERT = { eventName: ['INSERT'], dynamodb: { Keys: { pk: { S: ['user'] } } } };
const BOOKING_COMPLETED = { eventName: ['MODIFY'], dynamodb: { NewImage: { schema: { S: ['booking'] }, bookingCompletionTime: { N: [{ exists: true }] } } } };

// Bundling needs esbuild and the handler files; a plain Function keeps the test about the stack.
jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const lambdaLib = require('aws-cdk-lib/aws-lambda');
  class NodejsFunction extends lambdaLib.Function {
    constructor(scope, id, { entry, bundling, handler, ...props }) {
      super(scope, id, { ...props, handler: `index.${handler}`, code: lambdaLib.Code.fromInline('exports.handler = async () => ({})') });
      this.entry = entry;
    }
  }
  return { NodejsFunction };
});

const { createAdminRealtimeStack, grantRealtimePublish } = require('../../lib/admin-realtime-stack/admin-realtime-stack');

const STREAM_ARN = 'arn:aws:dynamodb:ca-central-1:111111111111:table/TransTable/stream/2026-01-01T00:00:00.000';
const TABLE_ARN = 'arn:aws:dynamodb:ca-central-1:111111111111:table/TransTable';
const REF_TABLE_ARN = 'arn:aws:dynamodb:ca-central-1:111111111111:table/RefTable';
// Not the default name, so a hardcoded 'userId-index' would fail the grant and env assertions
const USERID_INDEX = 'userId-gsi';

function fakeScope(sandboxName = null, overrides = {}, config = {}) {
  const layer = (name) => (consumer) => lambda.LayerVersion.fromLayerVersionArn(consumer, name, `arn:aws:lambda:ca-central-1:111111111111:layer:${name}:1`);
  const scope = {
    app: new App(),
    context: {},
    getAppName: () => 'ReserveRecApi',
    getDeploymentName: () => sandboxName || 'local',
    getSandboxName: () => sandboxName,
    isSandbox: () => !!sandboxName,
    isOffline: () => true,
    createScopedId: (id, suffix = 'Construct') => `${id}-${suffix}`,
    createStackId(stackKey) {
      return [this.getAppName(), this.getDeploymentName(), stackKey].map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
    },
    bindStackScope: () => {},
    // The methods below are bound to the stack by BaseStack.
    getConfigValue(key) { return key in config ? config[key] : this.config[key]; },
    setConfigValue(key, value) { this.config[key] = value; },
    getSecretValue() { return null; },
    getConstructId(key) {
      const construct = this.getConstructByKey(key);
      if (!construct) throw new Error(`Construct ${key} not found`);
      return construct.id;
    },
    getConstructName(key) { return this.getConstructByKey(key)?.name; },
    resolveBaseLayer: layer('BaseLayer'),
    resolveAwsUtilsLayer: layer('AwsUtilsLayer'),
    resolveAdminUserPoolId: () => 'ca-central-1_admin',
    resolveAdminUserPoolClientId: () => 'admin-client',
    resolveRefDataTableName: () => 'RefTable',
    resolveRefDataTableArn: () => REF_TABLE_ARN,
    resolveTransDataTableNameFromSsm: () => 'TransTable',
    resolveTransDataTableArnFromSsm: () => TABLE_ARN,
    resolveTransDataTableStreamArn: () => STREAM_ARN,
    resolveTransDataUserIdIndexName: () => USERID_INDEX,
    ...overrides,
  };
  return scope;
}

async function synth(sandboxName, config) {
  const stack = await createAdminRealtimeStack(fakeScope(sandboxName, {}, config), 'adminRealtimeStack');
  const template = Template.fromStack(stack);
  // logical id -> handler file name
  const files = {};
  for (const child of stack.node.findAll()) {
    if (child.entry) files[stack.getLogicalId(child.node.defaultChild)] = path.relative(HANDLER_DIR, child.entry);
  }
  return { stack, template, files };
}

const only = (template, type) => {
  const resources = Object.entries(template.findResources(type));
  expect(resources).toHaveLength(1);
  return resources[0];
};

const fnByFile = (template, files, file) => {
  const id = Object.keys(files).find((k) => files[k] === file);
  return { id, props: template.toJSON().Resources[id].Properties };
};

// IAM statements on the handler's role, excluding the log-retention and basic-execution plumbing
const roleStatements = (template, files, file) => {
  const role = fnByFile(template, files, file).props.Role['Fn::GetAtt'][0];
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) => p.Properties.Roles.some((r) => r.Ref === role))
    .flatMap((p) => p.Properties.PolicyDocument.Statement);
};

describe('AdminRealtimeStack', () => {
  let template, files, stack;
  beforeAll(async () => {
    ({ template, files, stack } = await synth());
  });
  const statementsFor = (file) => roleStatements(template, files, file);

  it('is named per the contract', () => {
    expect(stack.stackName).toBe('ReserveRecApi-Local-AdminRealtimeStack');
  });

  it('creates a WebSocket API routed on body.action with a ws stage that auto-deploys', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'WEBSOCKET',
      RouteSelectionExpression: '$request.body.action',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { StageName: 'ws', AutoDeploy: true });
    template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
  });

  it('routes each key to its handler file, replying on the control routes', () => {
    const resources = template.toJSON().Resources;
    const integrationFile = (target) => {
      const integrationId = target['Fn::Join'][1][1].Ref;
      const uri = JSON.stringify(resources[integrationId].Properties.IntegrationUri);
      return Object.keys(files).filter((id) => uri.includes(`"${id}"`)).map((id) => files[id])[0];
    };
    const routes = {};
    for (const route of Object.values(template.findResources('AWS::ApiGatewayV2::Route'))) {
      routes[route.Properties.RouteKey] = route.Properties;
    }
    expect(Object.fromEntries(Object.entries(routes).map(([key, r]) => [key, integrationFile(r.Target)]))).toEqual({
      $connect: 'connect.js',
      $disconnect: 'disconnect.js',
      $default: 'default.js',
      subscribe: 'subscribe.js',
      unsubscribe: 'unsubscribe.js',
      ping: 'ping.js',
    });
    for (const key of ['$default', 'subscribe', 'unsubscribe', 'ping']) {
      expect(routes[key].RouteResponseSelectionExpression).toBe('$default');
    }
  });

  it('authorizes $connect only, with the authorizer reading querystring.token', () => {
    const [authorizerId, authorizer] = only(template, 'AWS::ApiGatewayV2::Authorizer');
    expect(authorizer.Properties).toMatchObject({
      AuthorizerType: 'REQUEST',
      IdentitySource: ['route.request.querystring.token'],
    });
    expect(JSON.stringify(authorizer.Properties.AuthorizerUri)).toContain(fnByFile(template, files, 'authorizer.js').id);
    for (const route of Object.values(template.findResources('AWS::ApiGatewayV2::Route'))) {
      if (route.Properties.RouteKey === '$connect') {
        expect(route.Properties).toMatchObject({ AuthorizationType: 'CUSTOM', AuthorizerId: { Ref: authorizerId } });
      } else {
        expect(route.Properties.AuthorizationType).toBe('NONE');
      }
    }
  });

  it('creates the connection table with pk/sk, TTL, on-demand billing, no GSI, retained', () => {
    const [, table] = only(template, 'AWS::DynamoDB::Table');
    expect(table.Properties.KeySchema).toEqual([
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ]);
    expect(table.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    expect(table.Properties.TimeToLiveSpecification).toEqual({ AttributeName: 'ttl', Enabled: true });
    expect(table.Properties.GlobalSecondaryIndexes).toBeUndefined();
    expect(table.DeletionPolicy).toBe('Retain');
  });

  it('destroys the table in a sandbox', async () => {
    const { template: sandbox } = await synth('mysandbox');
    const [, table] = only(sandbox, 'AWS::DynamoDB::Table');
    expect(table.DeletionPolicy).toBe('Delete');
  });

  it('names each function after the stack so it is findable in logs', () => {
    const names = Object.fromEntries(Object.values(files).map((file) => [file, fnByFile(template, files, file).props.FunctionName]));
    expect(names).toEqual({
      'authorizer.js': 'ReserveRecApi-Local-AdminRealtimeStack-Authorizer',
      'connect.js': 'ReserveRecApi-Local-AdminRealtimeStack-Connect',
      'disconnect.js': 'ReserveRecApi-Local-AdminRealtimeStack-Disconnect',
      'subscribe.js': 'ReserveRecApi-Local-AdminRealtimeStack-Subscribe',
      'unsubscribe.js': 'ReserveRecApi-Local-AdminRealtimeStack-Unsubscribe',
      'ping.js': 'ReserveRecApi-Local-AdminRealtimeStack-Ping',
      'default.js': 'ReserveRecApi-Local-AdminRealtimeStack-Default',
      'publisher.js': 'ReserveRecApi-Local-AdminRealtimeStack-Publisher',
    });
  });

  it('runs every handler on Node 20 with both layers and the contract env vars', () => {
    const [tableId] = only(template, 'AWS::DynamoDB::Table');
    expect(Object.values(files).sort()).toEqual([
      'authorizer.js', 'connect.js', 'default.js', 'disconnect.js', 'ping.js', 'publisher.js', 'subscribe.js', 'unsubscribe.js',
    ]);
    for (const file of Object.values(files)) {
      const { props } = fnByFile(template, files, file);
      expect(props.Runtime).toBe('nodejs20.x');
      expect(props.Layers).toHaveLength(2);
      expect(props.Environment.Variables.LOG_LEVEL).toBe('info');
    }
    expect(fnByFile(template, files, 'authorizer.js').props.Environment.Variables).toMatchObject({
      ADMIN_USER_POOL_ID: 'ca-central-1_admin',
      ADMIN_USER_POOL_CLIENT_ID: 'admin-client',
      REFERENCE_DATA_TABLE_NAME: 'RefTable',
      REALTIME_STAFF_ADDED_ENABLED: 'false',
    });
    expect(fnByFile(template, files, 'subscribe.js').props.Environment.Variables.REALTIME_STAFF_ADDED_ENABLED).toBe('false');
    for (const file of ['connect.js', 'disconnect.js', 'subscribe.js', 'unsubscribe.js', 'ping.js', 'default.js']) {
      expect(fnByFile(template, files, file).props.Environment.Variables.ADMIN_REALTIME_TABLE_NAME).toEqual({ Ref: tableId });
    }
    const publisherEnv = fnByFile(template, files, 'publisher.js').props.Environment.Variables;
    expect(publisherEnv).toMatchObject({
      ADMIN_REALTIME_TABLE_NAME: { Ref: tableId },
      TRANSACTIONAL_DATA_TABLE_NAME: 'TransTable',
      REALTIME_STAFF_ADDED_ENABLED: 'false',
    });
    expect(JSON.stringify(publisherEnv.WEBSOCKET_MANAGEMENT_ENDPOINT)).toMatch(/https:\/\/.*\/ws/);
  });

  it('throttles the stage, with a separate higher limit on $connect', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 50 },
      RouteSettings: { $connect: { ThrottlingRateLimit: 200, ThrottlingBurstLimit: 400 } },
    });
  });

  it('creates the stage after every route, since its RouteSettings name $connect', () => {
    const [, stage] = only(template, 'AWS::ApiGatewayV2::Stage');
    const routeIds = Object.keys(template.findResources('AWS::ApiGatewayV2::Route'));
    expect(routeIds).toHaveLength(6);
    expect(stage.DependsOn).toEqual(expect.arrayContaining(routeIds));
  });

  // The token rides in the $connect query string, so any request logging on the stage would record it.
  it('turns on no data-trace, execution or access logging on the stage', () => {
    const [, stage] = only(template, 'AWS::ApiGatewayV2::Stage');
    expect(stage.Properties.AccessLogSettings).toBeUndefined();
    for (const settings of [stage.Properties.DefaultRouteSettings, ...Object.values(stage.Properties.RouteSettings)]) {
      expect(settings.DataTraceEnabled).toBeUndefined();
      expect(settings.LoggingLevel).toBeUndefined();
    }
  });

  it('lets the authorizer GetItem on the reference table and nothing else', () => {
    expect(statementsFor('authorizer.js')).toEqual([
      { Action: 'dynamodb:GetItem', Effect: 'Allow', Resource: REF_TABLE_ARN },
    ]);
  });

  it('grants each route handler only the table actions it uses', () => {
    const [tableId] = only(template, 'AWS::DynamoDB::Table');
    const tableActions = (file) => statementsFor(file)
      .filter((s) => JSON.stringify(s.Resource).includes(tableId))
      .flatMap((s) => [].concat(s.Action)).sort();
    expect(tableActions('connect.js')).toEqual(['dynamodb:PutItem']);
    expect(tableActions('disconnect.js')).toEqual(['dynamodb:DeleteItem']);
    expect(tableActions('subscribe.js')).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem']);
    expect(tableActions('unsubscribe.js')).toEqual(['dynamodb:DeleteItem']);
    expect(statementsFor('ping.js')).toEqual([]);
    expect(statementsFor('default.js')).toEqual([]);
    expect(tableActions('publisher.js')).toEqual(['dynamodb:BatchGetItem', 'dynamodb:DeleteItem', 'dynamodb:Query']);
  });

  it('consumes the transactional stream from LATEST, new users only, with an SQS on-failure destination', () => {
    const [queueId] = only(template, 'AWS::SQS::Queue');
    const [, mapping] = only(template, 'AWS::Lambda::EventSourceMapping');
    expect(mapping.Properties).toMatchObject({
      EventSourceArn: STREAM_ARN,
      FunctionName: { Ref: fnByFile(template, files, 'publisher.js').id },
      StartingPosition: 'LATEST',
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: 3,
      DestinationConfig: { OnFailure: { Destination: { 'Fn::GetAtt': [queueId, 'Arn'] } } },
      FilterCriteria: { Filters: [{ Pattern: JSON.stringify(USER_INSERT) }] },
    });
    expect(queueId).toMatch(/PublisherFailureQueue/);
  });

  it('adds the booking-completed filter and passes the flag on when staff added events are enabled', async () => {
    const { template: enabled, files: enabledFiles } = await synth(null, { realtimeStaffAddedEnabled: 'true' });
    const [, mapping] = only(enabled, 'AWS::Lambda::EventSourceMapping');
    expect(mapping.Properties.FilterCriteria).toEqual({
      Filters: [USER_INSERT, BOOKING_COMPLETED].map((f) => ({ Pattern: JSON.stringify(f) })),
    });
    for (const file of ['authorizer.js', 'subscribe.js', 'publisher.js']) {
      expect(fnByFile(enabled, enabledFiles, file).props.Environment.Variables.REALTIME_STAFF_ADDED_ENABLED).toBe('true');
    }
  });

  it('grants the publisher ManageConnections, GetItem on the transactional table and Query on its userId index only', () => {
    const statements = statementsFor('publisher.js');
    const json = JSON.stringify(statements);
    expect(json).toContain('execute-api:ManageConnections');
    expect(json).toContain('@connections');
    const tableStatements = statements.filter((s) => JSON.stringify(s.Resource).includes(TABLE_ARN) && s.Resource !== STREAM_ARN);
    expect(tableStatements).toEqual([
      { Action: 'dynamodb:GetItem', Effect: 'Allow', Resource: TABLE_ARN },
      { Action: 'dynamodb:Query', Effect: 'Allow', Resource: `${TABLE_ARN}/index/${USERID_INDEX}` },
    ]);
    expect(fnByFile(template, files, 'publisher.js').props.Environment.Variables.USERID_INDEX_NAME).toBe(USERID_INDEX);
  });

  it('adds one stream consumer per source, and none for topics that publish directly', async () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    const env = fnByFile(template, files, 'publisher.js').props.Environment.Variables;
    expect(JSON.parse(env.REALTIME_SOURCES)).toEqual({ TransTable: 'transactional' });
    const { TOPICS } = require('../../src/handlers/admin-realtime/topics');
    expect(Object.values(TOPICS).map((t) => t.source)).toEqual(['transactional']);
  });

  it('resolves a token table name inside REALTIME_SOURCES', async () => {
    const { CfnParameter } = require('aws-cdk-lib');
    let transName;
    const scope = fakeScope(null, {
      resolveTransDataTableNameFromSsm: (stack) => (transName ||= new CfnParameter(stack, 'TransName').valueAsString),
    });
    const stack = await createAdminRealtimeStack(scope, 'adminRealtimeStack');
    const resources = Template.fromStack(stack).toJSON().Resources;
    const publisher = Object.values(resources).find((r) => r.Properties?.FunctionName === 'ReserveRecApi-Local-AdminRealtimeStack-Publisher');
    const joined = publisher.Properties.Environment.Variables.REALTIME_SOURCES['Fn::Join'];
    const rendered = joined[1].map((part) => (part.Ref === 'TransName' ? 'TOKEN_TABLE' : part)).join(joined[0]);
    expect(JSON.parse(rendered)).toEqual({ TOKEN_TABLE: 'transactional' });
  });

  describe('topic sources that the stack cannot wire', () => {
    // extraSources are added to this isolated copy of STREAM_SOURCES only
    const synthWithTopics = (topicsModule, extraSources = {}, scopeOverrides = {}) => {
      let create;
      jest.isolateModules(() => {
        jest.doMock('../../src/handlers/admin-realtime/topics', () => topicsModule);
        const stackModule = require('../../lib/admin-realtime-stack/admin-realtime-stack');
        Object.assign(stackModule.STREAM_SOURCES, extraSources);
        create = stackModule.createAdminRealtimeStack;
      });
      return create(fakeScope(null, scopeOverrides), 'adminRealtimeStack');
    };
    const topic = (source) => ({ source, minTier: 'staff', filters: () => [USER_INSERT] });

    it('adds a REALTIME_SOURCES key and a stream consumer for a second mapped source', async () => {
      const REF_STREAM_ARN = `${REF_TABLE_ARN}/stream/2026-01-01T00:00:00.000`;
      const reference = {
        importId: 'ImportedReferenceDataTable',
        table: (scope, stack) => ({
          tableName: scope.resolveRefDataTableName(stack),
          tableArn: scope.resolveRefDataTableArn(stack),
          tableStreamArn: REF_STREAM_ARN,
        }),
        wire: () => {},
      };
      const stack = await synthWithTopics(
        { TOPICS: { customers: topic('transactional'), facilities: topic('reference') } },
        { reference },
      );
      const t = Template.fromStack(stack);
      const resources = t.toJSON().Resources;
      const publisher = Object.values(resources).find((r) => r.Properties?.FunctionName === 'ReserveRecApi-Local-AdminRealtimeStack-Publisher');
      expect(JSON.parse(publisher.Properties.Environment.Variables.REALTIME_SOURCES)).toEqual({ TransTable: 'transactional', RefTable: 'reference' });
      const mappings = Object.values(t.findResources('AWS::Lambda::EventSourceMapping')).map((m) => m.Properties.EventSourceArn).sort();
      expect(mappings).toEqual([REF_STREAM_ARN, STREAM_ARN].sort());
    });

    it('fails synth, fatally, on a topic with an unknown source', async () => {
      await expect(synthWithTopics({ TOPICS: { customers: topic('reference') } }))
        .rejects.toMatchObject({ fatal: true, message: expect.stringContaining('topic "customers" has unknown source "reference"') });
    });

    it('adds no stream consumer for a topic with source null', async () => {
      const stack = await synthWithTopics({ TOPICS: { direct: topic(null) } });
      Template.fromStack(stack).resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    });
  });

  const dummyFn = (scopeConstruct) => new lambda.Function(scopeConstruct, 'Dummy', {
    runtime: lambda.Runtime.NODEJS_20_X, handler: 'index.handler', code: lambda.Code.fromInline('x'),
  });
  const policyStatements = (t, fnId) => {
    const role = t.toJSON().Resources[fnId].Properties.Role['Fn::GetAtt'][0];
    return Object.values(t.findResources('AWS::IAM::Policy'))
      .filter((p) => p.Properties.Roles.some((r) => r.Ref === role))
      .flatMap((p) => p.Properties.PolicyDocument.Statement);
  };

  it('grantRealtimePublish gives a function in this stack exactly what publish() needs', async () => {
    const scope = fakeScope();
    const stack = await createAdminRealtimeStack(scope, 'adminRealtimeStack');
    const dummy = dummyFn(stack);
    stack.grantRealtimePublish(dummy);
    const t = Template.fromStack(stack);
    const resources = t.toJSON().Resources;
    const dummyId = stack.getLogicalId(dummy.node.defaultChild);
    const [tableId] = only(t, 'AWS::DynamoDB::Table');
    const [, stage] = only(t, 'AWS::ApiGatewayV2::Stage');
    const statements = policyStatements(t, dummyId);
    const [apiId] = only(t, 'AWS::ApiGatewayV2::Api');
    expect(statements).toEqual([
      {
        Action: 'execute-api:ManageConnections',
        Effect: 'Allow',
        Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':execute-api:ca-central-1:000000000000:', { Ref: apiId }, '/ws/*/@connections/*']] },
      },
      {
        Action: ['dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:DeleteItem'],
        Effect: 'Allow',
        Resource: [{ 'Fn::GetAtt': [tableId, 'Arn'] }],
      },
    ]);
    const env = resources[dummyId].Properties.Environment.Variables;
    expect(Object.keys(env).sort()).toEqual(['ADMIN_REALTIME_TABLE_NAME', 'WEBSOCKET_MANAGEMENT_ENDPOINT']);
    expect(env.ADMIN_REALTIME_TABLE_NAME).toEqual({ Ref: tableId });
    expect(JSON.stringify(env.WEBSOCKET_MANAGEMENT_ENDPOINT)).toMatch(/https:\/\/.*\/ws/);
    expect(stage.Properties.StageName).toBe('ws');
  });

  it('the exported grantRealtimePublish works from a stack built before AdminRealtimeStack, reading SSM and importing no export', async () => {
    const scope = fakeScope();
    const consumer = Object.assign(new Stack(scope.app, 'Consumer', { env: { account: '000000000000', region: 'ca-central-1' } }), { appScope: scope });
    const dummy = dummyFn(consumer);
    grantRealtimePublish(dummy);
    const t = Template.fromStack(consumer);
    // The paths it reads are the ones the stack exports
    const readPaths = Object.values(t.toJSON().Parameters).filter((p) => p.Type === 'AWS::SSM::Parameter::Value<String>').map((p) => p.Default)
      .filter((name) => !name.startsWith('/cdk-bootstrap/'));
    expect(readPaths.sort()).toEqual(['adminRealtimeTableArn', 'adminRealtimeTableName', 'wsApiId', 'wsManagementEndpoint']
      .map((key) => `/reserveRecApi/local/adminRealtimeStack/${key}`));
    const exported = Object.values(template.findResources('AWS::SSM::Parameter')).map((p) => p.Properties.Name);
    expect(exported).toEqual(expect.arrayContaining(readPaths));
    const json = JSON.stringify(t.toJSON());
    expect(json).not.toContain('Fn::ImportValue');
    expect(json).not.toContain('AdminRealtimeStack:');
    const ssmParam = (key) => ({ Ref: expect.stringMatching(new RegExp(`^SsmParameterValuereserveRecApilocaladminRealtimeStack${key}`)) });
    const dummyId = consumer.getLogicalId(dummy.node.defaultChild);
    expect(policyStatements(t, dummyId)).toEqual([
      {
        Action: 'execute-api:ManageConnections',
        Effect: 'Allow',
        Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':execute-api:ca-central-1:000000000000:', ssmParam('wsApiId'), '/ws/*/@connections/*']] },
      },
      {
        Action: ['dynamodb:Query', 'dynamodb:BatchGetItem', 'dynamodb:DeleteItem'],
        Effect: 'Allow',
        Resource: ssmParam('adminRealtimeTableArn'),
      },
    ]);
    expect(t.toJSON().Resources[dummyId].Properties.Environment.Variables).toEqual({
      ADMIN_REALTIME_TABLE_NAME: ssmParam('adminRealtimeTableName'),
      WEBSOCKET_MANAGEMENT_ENDPOINT: ssmParam('wsManagementEndpoint'),
    });
  });

  it('keeps the imported-table guard fatal through the stack wrapper', async () => {
    const guard = Object.assign(new Error('imported by name'), { fatal: true });
    const scope = fakeScope(null, { resolveTransDataTableStreamArn: () => { throw guard; } });
    await expect(createAdminRealtimeStack(scope, 'adminRealtimeStack')).rejects.toMatchObject({ fatal: true });
  });

  it('counts the realtime events from each emitting handler, with no alarms', () => {
    const filters = Object.values(template.findResources('AWS::Logs::MetricFilter')).map((f) => f.Properties);
    expect(filters.map((f) => f.MetricTransformations[0].MetricName).sort()).toEqual([
      'realtime_connected', 'realtime_disconnected', 'realtime_message_sent', 'realtime_publish_failed', 'realtime_send_failed',
      'realtime_subscribe_forbidden',
    ]);
    for (const f of filters) {
      expect(f.FilterPattern).toBe(`"event=${f.MetricTransformations[0].MetricName}"`);
      expect(f.MetricTransformations[0].MetricNamespace).toBe('ReserveRecApi/local');
    }
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });

  describe('admin config WEBSOCKET_URL', () => {
    // The custom resource's calls are JSON with the stage URL tokens joined in; render them back to objects.
    const call = (property) => {
      const [, resource] = only(template, 'Custom::AWS');
      const value = resource.Properties[property];
      const json = typeof value === 'string' ? value
        : value['Fn::Join'][1].map((part) => (typeof part === 'string' ? part : 'TOKEN')).join('');
      return JSON.parse(json);
    };
    const KEY = { pk: { S: 'config' }, sk: { S: 'admin' } };

    it('sets it on create and update, with the stage URL and a constant physical id', () => {
      for (const property of ['Create', 'Update']) {
        const c = call(property);
        expect(c).toMatchObject({
          service: 'DynamoDB',
          action: 'UpdateItem',
          parameters: { TableName: 'RefTable', Key: KEY, UpdateExpression: 'SET WEBSOCKET_URL = :url' },
          physicalResourceId: { id: 'config-admin-WEBSOCKET_URL' },
        });
        expect(c.parameters.ExpressionAttributeValues[':url'].S).toMatch(/^wss:\/\/TOKEN.*\/ws$/);
      }
      const [, resource] = only(template, 'Custom::AWS');
      expect(JSON.stringify(resource.Properties.Create)).toContain(only(template, 'AWS::ApiGatewayV2::Api')[0]);
      expect(resource.Properties.InstallLatestAwsSdk).toBe(false);
    });

    it('removes it on delete', () => {
      expect(call('Delete')).toEqual({
        service: 'DynamoDB',
        action: 'UpdateItem',
        parameters: { TableName: 'RefTable', Key: KEY, UpdateExpression: 'REMOVE WEBSOCKET_URL' },
        physicalResourceId: { id: 'config-admin-WEBSOCKET_URL' },
      });
    });

    it('may only UpdateItem WEBSOCKET_URL on the config items of the reference table', () => {
      const [, resource] = only(template, 'Custom::AWS');
      const policy = Object.values(template.findResources('AWS::IAM::Policy'))
        .find((p) => (resource.DependsOn || []).some((d) => template.toJSON().Resources[d] === p));
      // The REMOVE on delete names the same attributes as the SET, so one attribute list covers both calls
      expect(policy.Properties.PolicyDocument.Statement).toEqual([{
        Action: 'dynamodb:UpdateItem',
        Effect: 'Allow',
        Resource: REF_TABLE_ARN,
        Condition: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': ['config'],
            'dynamodb:Attributes': ['pk', 'sk', 'WEBSOCKET_URL'],
          },
          Null: { 'dynamodb:LeadingKeys': 'false', 'dynamodb:Attributes': 'false' },
          StringEqualsIfExists: { 'dynamodb:ReturnValues': ['NONE'] },
        },
      }]);
      for (const property of ['Create', 'Update', 'Delete']) {
        expect(call(property).parameters.Key).toEqual(KEY);
        expect(call(property).parameters.ReturnValues).toBeUndefined();
      }
    });
  });

  it('exports the stage and management URLs to SSM', () => {
    for (const key of ['wsApiUrl', 'wsManagementEndpoint']) {
      template.hasResourceProperties('AWS::SSM::Parameter', { Name: `/reserveRecApi/local/adminRealtimeStack/${key}` });
    }
  });
});

describe('bin/app.js stack errors', () => {
  const { CDKProject, run } = require('../../bin/app.js');
  const project = (failFast) => ({ context: { FAIL_FAST: failFast }, progress: { totalStacks: 0, failedStacks: [] }, stacks: {} });
  const addStack = (failFast, error) => CDKProject.prototype.addStack.call(project(failFast), 'someStack', async () => { throw error; });

  beforeEach(() => { process.exitCode = undefined; });
  afterAll(() => { process.exitCode = undefined; });

  it('logs and continues on a non-fatal error unless FAIL_FAST, and never sets the exit code', async () => {
    await expect(addStack('false', new Error('boom'))).resolves.toBeUndefined();
    await expect(addStack('true', new Error('boom'))).rejects.toThrow('Error creating stack someStack: Error: boom');
    await run({ buildProject: async () => { throw new Error('boom'); } });
    expect(process.exitCode).toBeUndefined();
  });

  it('rethrows a fatal error even without FAIL_FAST and exits non-zero', async () => {
    const fatal = Object.assign(new Error('imported by name'), { fatal: true });
    await expect(addStack('false', fatal)).rejects.toBe(fatal);
    await run({ buildProject: async () => { throw fatal; } });
    expect(process.exitCode).toBe(1);
  });
});
