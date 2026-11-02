'use strict';

// Synthesizes a LambdaConstruct (src/handlers/*/constructs.js) in a bare stack and reads back its routes and table grants.
const path = require('path');
const { App, Stack } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const apigw = require('aws-cdk-lib/aws-apigateway');
const lambda = require('aws-cdk-lib/aws-lambda');

const REPO_ROOT = path.join(__dirname, '../..');
const ACCOUNT = '111111111111';
const REF_TABLE_ARN = `arn:aws:dynamodb:ca-central-1:${ACCOUNT}:table/RefTable`;
const TRANS_TABLE_ARN = `arn:aws:dynamodb:ca-central-1:${ACCOUNT}:table/TransTable`;
const AUDIT_TABLE_ARN = `arn:aws:dynamodb:ca-central-1:${ACCOUNT}:table/AuditTable`;

// Use as: jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());
function nodejsFunctionMock() {
  const lambdaLib = require('aws-cdk-lib/aws-lambda');
  class NodejsFunction extends lambdaLib.Function {
    constructor(scope, id, { entry, bundling, logRetention, ...props }) {
      super(scope, id, { ...props, handler: 'index.handler', code: lambdaLib.Code.fromInline('exports.handler = async () => ({})') });
      this.entry = entry;
    }
  }
  return { NodejsFunction, LogLevel: { ERROR: 'error' } };
}

// A bare stack carrying the scope helpers handler constructs call.
function testStack() {
  const stack = new Stack(new App(), 'TestStack', { env: { account: ACCOUNT, region: 'ca-central-1' } });
  stack.concreteStackId = 'TestStack';
  stack.createScopedId = (id, suffix = 'Construct') => `${id}-${suffix}`;
  stack.getAppName = () => 'ReserveRecApi';
  stack.getDeploymentName = () => 'test';
  return stack;
}

// The stack-level scope helpers handler constructs resolve table names and ARNs through.
function appScopeStub(stack) {
  return {
    getAppName: stack.getAppName,
    getDeploymentName: stack.getDeploymentName,
    resolveRefDataTableName: () => 'RefTable',
    resolveRefDataTableArn: () => REF_TABLE_ARN,
    resolveTransDataTableName: () => 'TransTable',
    resolveTransDataTableArn: () => TRANS_TABLE_ARN,
    resolveAuditTableArn: () => AUDIT_TABLE_ARN,
    resolveAuditTableName: () => 'AuditTable',
    resolveOpenSearchDomainEndpoint: () => 'search.local',
    resolveOpenSearchReferenceDataIndexName: () => 'ref-index',
    resolveOpenSearchTransactionalDataIndexName: () => 'trans-index',
  };
}

// Returns { routes, roles, grants }. Pass `authorizer: undefined` for a construct that never attaches one; CDK rejects an unattached authorizer.
function synthConstruct(ConstructClass, props = {}) {
  const stack = testStack();
  stack.appScope = appScopeStub(stack);

  const api = new apigw.RestApi(stack, 'Api');
  const authorizer = 'authorizer' in props ? props.authorizer : new apigw.TokenAuthorizer(stack, 'Authorizer', {
    handler: new lambda.Function(stack, 'AuthorizerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => ({})'),
    }),
  });
  const layers = [lambda.LayerVersion.fromLayerVersionArn(stack, 'Layer', `arn:aws:lambda:ca-central-1:${ACCOUNT}:layer:base:1`)];

  new ConstructClass(stack, 'Subject', { api, authorizer, layers, ...props });
  const resources = Template.fromStack(stack).toJSON().Resources;
  const roles = readRoles(stack, resources);
  const grants = Object.fromEntries(Object.entries(roles).map(([file, role]) => [file, actionsOn(role, REF_TABLE_ARN)]));
  return { routes: readRoutes(stack, resources), roles, grants };
}

// Handlers by function logical id, as repo-relative file paths.
function handlerFiles(stack) {
  const files = {};
  for (const child of stack.node.findAll()) {
    if (child.entry) files[stack.getLogicalId(child.node.defaultChild)] = path.relative(REPO_ROOT, child.entry);
  }
  return files;
}

// "GET /policies/{policyType}" -> { auth: 'CUSTOM' | 'NONE', handler: 'src/handlers/.../admin.js' }
function readRoutes(stack, resources) {
  const files = handlerFiles(stack);
  const pathOf = (ref) => {
    const parent = ref?.Ref && resources[ref.Ref];
    return parent ? `${pathOf(parent.Properties.ParentId)}/${parent.Properties.PathPart}` : '';
  };
  const routes = {};
  for (const res of Object.values(resources)) {
    if (res.Type !== 'AWS::ApiGateway::Method' || res.Properties.HttpMethod === 'OPTIONS') continue;
    const uri = JSON.stringify(res.Properties.Integration?.Uri);
    const fnId = Object.keys(files).find((id) => uri.includes(`"${id}"`));
    routes[`${res.Properties.HttpMethod} ${pathOf(res.Properties.ResourceId)}`] = { auth: res.Properties.AuthorizationType, handler: files[fnId] };
  }
  return routes;
}

// handler file -> { env, statements: [{ actions, resources }] } for its role
function readRoles(stack, resources) {
  const roles = {};
  for (const [logicalId, file] of Object.entries(handlerFiles(stack))) {
    const fn = resources[logicalId];
    const roleId = fn.Properties.Role['Fn::GetAtt'][0];
    const statements = Object.values(resources)
      .filter((r) => r.Type === 'AWS::IAM::Policy' && r.Properties.Roles.some((role) => role.Ref === roleId))
      .flatMap((r) => r.Properties.PolicyDocument.Statement)
      .map((st) => ({ actions: [].concat(st.Action), resources: [].concat(st.Resource) }));
    roles[file] = { env: fn.Properties.Environment?.Variables || {}, statements };
  }
  return roles;
}

// Actions granted on resources matching `match` (exact string, or a predicate over the resource).
function actionsOn(role, match) {
  const hit = typeof match === 'function' ? match : (r) => r === match;
  return [...new Set(role.statements.filter((st) => st.resources.some(hit)).flatMap((st) => st.actions))].sort();
}

const allActions = (role) => [...new Set(role.statements.flatMap((st) => st.actions))].sort();

// routes -> { "GET /path": "CUSTOM" }, for tests that only care who is let in
function authByRoute(routes) {
  return Object.fromEntries(Object.entries(routes).map(([route, { auth }]) => [route, auth]));
}

// "METHOD /path" -> authorization type for every route in a stack that holds several constructs on one api
function authByRouteIn(stack) {
  return authByRoute(readRoutes(stack, Template.fromStack(stack).toJSON().Resources));
}

// grants -> number of handlers allowed to write the reference table
function writerCount(grants) {
  return Object.values(grants).filter((actions) => actions.includes('dynamodb:PutItem')).length;
}

module.exports = { AUDIT_TABLE_ARN, TRANS_TABLE_ARN, nodejsFunctionMock, appScopeStub, authByRouteIn, testStack, synthConstruct, authByRoute, writerCount, actionsOn, allActions };
