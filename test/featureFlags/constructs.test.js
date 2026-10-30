'use strict';

const { App, Stack } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const apigw = require('aws-cdk-lib/aws-apigateway');
const lambda = require('aws-cdk-lib/aws-lambda');

// Bundling needs esbuild; a plain Function keeps the test about the wiring.
jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const lambdaLib = require('aws-cdk-lib/aws-lambda');
  class NodejsFunction extends lambdaLib.Function {
    constructor(scope, id, { entry, bundling, handler, ...props }) {
      super(scope, id, { ...props, handler: 'index.handler', code: lambdaLib.Code.fromInline('exports.handler = async () => ({})') });
      this.entry = entry;
    }
  }
  return { NodejsFunction, LogLevel: { ERROR: 'error' } };
});

const { AdminFeatureFlagsConstruct } = require('../../src/handlers/featureFlags/constructs');

const REF_TABLE_ARN = 'arn:aws:dynamodb:ca-central-1:111111111111:table/RefTable';

function synth() {
  const stack = new Stack(new App(), 'Test');
  stack.concreteStackId = 'Test';
  stack.createScopedId = (id, suffix = 'Construct') => `${id}-${suffix}`;
  stack.appScope = {
    resolveRefDataTableName: () => 'RefTable',
    resolveRefDataTableArn: () => REF_TABLE_ARN,
    resolveTransDataTableName: () => 'TransTable',
    resolveAuditTableName: () => 'AuditTable',
    resolveAuditTableArn: () => 'arn:aws:dynamodb:ca-central-1:111111111111:table/AuditTable',
    resolveOpenSearchDomainEndpoint: () => 'search.example',
    resolveOpenSearchReferenceDataIndexName: () => 'ref',
    resolveOpenSearchTransactionalDataIndexName: () => 'trans',
  };

  const api = new apigw.RestApi(stack, 'Api');
  const authFn = new lambda.Function(stack, 'AuthFn', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({})'),
  });
  const authorizer = new apigw.RequestAuthorizer(stack, 'Authorizer', { handler: authFn, identitySources: [apigw.IdentitySource.header('Authorization')] });
  const layer = lambda.LayerVersion.fromLayerVersionArn(stack, 'Layer', 'arn:aws:lambda:ca-central-1:111111111111:layer:Base:1');

  const construct = new AdminFeatureFlagsConstruct(stack, 'FeatureFlags', { api, authorizer, layers: [layer] });
  return { stack, construct, template: Template.fromStack(stack) };
}

const entryName = (fn) => fn.entry.split('/').slice(-2).join('/');

describe('AdminFeatureFlagsConstruct', () => {
  const { stack, construct, template } = synth();
  const logicalId = (fn) => stack.getLogicalId(fn.node.defaultChild);
  const resources = template.toJSON().Resources;

  const resourceId = (pathPart, parentId) => Object.keys(resources).find((k) => {
    const r = resources[k];
    return r.Type === 'AWS::ApiGateway::Resource' && r.Properties.PathPart === pathPart
      && (!parentId || r.Properties.ParentId.Ref === parentId);
  });
  const getMethod = (resId) => Object.values(resources).find((r) => r.Type === 'AWS::ApiGateway::Method'
    && r.Properties.HttpMethod === 'GET' && r.Properties.ResourceId.Ref === resId);
  const optionsMethod = (resId) => Object.values(resources).find((r) => r.Type === 'AWS::ApiGateway::Method'
    && r.Properties.HttpMethod === 'OPTIONS' && r.Properties.ResourceId.Ref === resId);

  const flagsId = resourceId('featureFlags');
  const adminId = resourceId('admin', flagsId);

  it('adds GET /featureFlags/admin behind the custom authorizer', () => {
    const method = getMethod(adminId);

    expect(method).toBeDefined();
    expect(method.Properties.AuthorizationType).toBe('CUSTOM');
    expect(method.Properties.AuthorizerId).toBeDefined();
  });

  it('maps GET /featureFlags/admin to GET/admin.js', () => {
    expect(entryName(construct.featureFlagsGetAdminFunction)).toBe('GET/admin.js');
    expect(JSON.stringify(getMethod(adminId).Properties.Integration.Uri))
      .toContain(logicalId(construct.featureFlagsGetAdminFunction));
  });

  it('answers CORS preflight on /featureFlags/admin', () => {
    expect(optionsMethod(adminId)).toBeDefined();
  });

  it('keeps GET /featureFlags open and mapped to the public handler', () => {
    const method = getMethod(flagsId);

    expect(method.Properties.AuthorizationType).toBe('NONE');
    expect(entryName(construct.featureFlagsGetPublicFunction)).toBe('GET/public.js');
    expect(JSON.stringify(method.Properties.Integration.Uri))
      .toContain(logicalId(construct.featureFlagsGetPublicFunction));
  });

  it('keeps PUT /featureFlags behind the custom authorizer', () => {
    const put = Object.values(resources).find((r) => r.Type === 'AWS::ApiGateway::Method'
      && r.Properties.HttpMethod === 'PUT' && r.Properties.ResourceId.Ref === flagsId);

    expect(put.Properties.AuthorizationType).toBe('CUSTOM');
    expect(entryName(construct.featureFlagsPutFunction)).toBe('PUT/admin.js');
    expect(JSON.stringify(put.Properties.Integration.Uri)).toContain(logicalId(construct.featureFlagsPutFunction));
  });

  it('gives the admin read handler read-only access to the reference table', () => {
    const roleLogicalId = stack.getLogicalId(construct.featureFlagsGetAdminFunction.role.node.defaultChild);
    const statements = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((p) => p.Properties.Roles.some((r) => r.Ref === roleLogicalId))
      .flatMap((p) => p.Properties.PolicyDocument.Statement);
    const actionsOf = (list) => list.flatMap((s) => [].concat(s.Action));
    const refActions = actionsOf(statements.filter((s) => JSON.stringify(s.Resource).includes('RefTable')));

    expect(refActions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query']));
    expect(actionsOf(statements).filter((a) => /Put|Update|Delete|BatchWrite|Write/.test(a))).toEqual([]);
  });
});
