'use strict';

const apigw = require('aws-cdk-lib/aws-apigateway');
const lambda = require('aws-cdk-lib/aws-lambda');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const secretsmanager = require('aws-cdk-lib/aws-secretsmanager');
const { Template } = require('aws-cdk-lib/assertions');

// Bundling needs esbuild; a plain Function keeps the test about routes and their authorizers.
jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { AdminFeatureFlagsConstruct, PublicFeatureFlagsConstruct } = require('../../src/handlers/featureFlags/constructs');
const { AdminConfigLambdas, PublicConfigLambdas } = require('../../src/handlers/config/constructs');
const { UsersConstruct } = require('../../src/handlers/users/constructs');
const { ReportsConstruct } = require('../../src/handlers/reports/constructs');
const { VerifyConstruct } = require('../../src/handlers/verify/constructs');
const { AdminSearchLambda, PublicSearchLambda } = require('../../src/handlers/search/constructs');
const { WorldlineNotificationConstruct } = require('../../src/handlers/worldlineNotification/constructs');
const { WaitingRoomPublicConstruct } = require('../../src/handlers/waiting-room/constructs');
const { AdminWaitingRoomConstruct } = require('../../src/handlers/waiting-room/admin/constructs');
const { PingApiConstruct } = require('../../src/handlers/ping/constructs');
const { BCSCConstruct } = require('../../src/handlers/bcsc/constructs');

const { testStack, appScopeStub, authByRouteIn } = require('../helpers/cdkConstruct');

const ARN = (name) => `arn:aws:dynamodb:ca-central-1:111111111111:table/${name}`;

function apiStack() {
  const stack = testStack();
  stack.appScope = appScopeStub(stack);
  const api = new apigw.RestApi(stack, 'Api');
  const authFn = new lambda.Function(stack, 'AuthFn', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.handler', code: lambda.Code.fromInline('x') });
  const authorizer = new apigw.RequestAuthorizer(stack, 'Authorizer', { handler: authFn, identitySources: [apigw.IdentitySource.header('Authorization')] });
  const layers = [lambda.LayerVersion.fromLayerVersionArn(stack, 'Base', 'arn:aws:lambda:ca-central-1:111111111111:layer:base:1')];
  return { stack, props: { api, authorizer, layers, environment: { API_NAME: 'Test' } } };
}

describe('handler routes and their authorizers', () => {
  it('admin API: only the feature-flag, config and BCSC OAuth proxy routes are open', () => {
    const { stack, props } = apiStack();
    new AdminFeatureFlagsConstruct(stack, 'FeatureFlags', props);
    new AdminConfigLambdas(stack, 'Config', props);
    new UsersConstruct(stack, 'Users', { ...props, openSearchDomainArn: 'arn:aws:es:ca-central-1:111111111111:domain/d' });
    new ReportsConstruct(stack, 'Reports', props);
    new VerifyConstruct(stack, 'Verify', props);
    new AdminSearchLambda(stack, 'Search', { ...props, opensearchDomainArn: 'arn:aws:es:ca-central-1:111111111111:domain/d' });
    new AdminWaitingRoomConstruct(stack, 'WaitingRoomAdmin', { ...props, waitingRoomTableName: 'WrTable', waitingRoomTableArn: ARN('WrTable'), releaseLambdaArn: 'arn:aws:lambda:ca-central-1:111111111111:function:release', viewerFunctionName: 'viewer' });
    new BCSCConstruct(stack, 'BCSC', props);

    expect(authByRouteIn(stack)).toEqual({
      'GET /featureFlags': 'NONE',
      'PUT /featureFlags': 'CUSTOM',
      'GET /config': 'NONE',
      'GET /users/me': 'CUSTOM',
      'GET /users/{userPoolId}': 'CUSTOM',
      'GET /users/{userPoolId}/{sub}': 'CUSTOM',
      'POST /users/search': 'CUSTOM',
      'GET /reports/daily-passes': 'CUSTOM',
      'GET /verify/{bookingId}/{hash}': 'CUSTOM',
      'POST /search': 'CUSTOM',
      'GET /waiting-room/queues': 'CUSTOM',
      'POST /waiting-room/queues': 'CUSTOM',
      'DELETE /waiting-room/queues/{queueId}': 'CUSTOM',
      'POST /waiting-room/queues/{queueId}/close': 'CUSTOM',
      'GET /waiting-room/queues/{queueId}/metrics': 'CUSTOM',
      'POST /waiting-room/mode2': 'CUSTOM',
      'POST /waiting-room/mode2/release': 'CUSTOM',
      'GET /bcsc/jwks': 'NONE',
      'GET /bcsc/userinfo/{env}': 'NONE',
      'POST /bcsc/token/{env}': 'NONE',
    });
  });

  it('public API: waiting-room writes need a token, reads and the payment webhook do not', () => {
    const { stack, props } = apiStack();
    new PublicFeatureFlagsConstruct(stack, 'FeatureFlags', props);
    new PublicConfigLambdas(stack, 'Config', props);
    new PublicSearchLambda(stack, 'Search', { ...props, opensearchDomainArn: 'arn:aws:es:ca-central-1:111111111111:domain/d' });
    new WorldlineNotificationConstruct(stack, 'Worldline', { ...props, emailQueueUrl: 'https://sqs/q', emailQueueArn: 'arn:aws:sqs:ca-central-1:111111111111:q' });
    new WaitingRoomPublicConstruct(stack, 'WaitingRoom', props);
    new PingApiConstruct(stack, 'Ping', props);

    expect(authByRouteIn(stack)).toEqual({
      'GET /featureFlags': 'NONE',
      'GET /config': 'NONE',
      'POST /search': 'NONE',
      'POST /worldline-notification': 'NONE',
      'POST /waiting-room/join': 'CUSTOM',
      'POST /waiting-room/claim': 'CUSTOM',
      'POST /waiting-room/heartbeat': 'CUSTOM',
      'GET /waiting-room/mode2/status': 'NONE',
      'GET /ping': 'NONE',
    });
  });

  it('public waiting room: mode2 status only reads the table, only claim and heartbeat read the HMAC key', () => {
    const { stack, props } = apiStack();
    const waitingRoomTable = new dynamodb.Table(stack, 'WrTable', { partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING } });
    const hmacSigningKey = new secretsmanager.Secret(stack, 'Hmac');
    const c = new WaitingRoomPublicConstruct(stack, 'WaitingRoom', { ...props, waitingRoomTable, hmacSigningKey });

    const policies = Object.values(Template.fromStack(stack).findResources('AWS::IAM::Policy'));
    const actionsOf = (fn) => {
      const roleId = stack.getLogicalId(fn.role.node.defaultChild);
      return policies
        .filter((p) => p.Properties.Roles.some((r) => r.Ref === roleId))
        .flatMap((p) => p.Properties.PolicyDocument.Statement.flatMap((st) => [].concat(st.Action)));
    };

    expect(actionsOf(c.mode2StatusFunction)).toContain('dynamodb:Query');
    expect(actionsOf(c.mode2StatusFunction)).not.toContain('dynamodb:PutItem');
    expect(actionsOf(c.joinFunction)).toContain('dynamodb:PutItem');
    expect(actionsOf(c.claimFunction)).toContain('secretsmanager:GetSecretValue');
    expect(actionsOf(c.heartbeatFunction)).toContain('secretsmanager:GetSecretValue');
    expect(actionsOf(c.joinFunction)).not.toContain('secretsmanager:GetSecretValue');
  });
});
