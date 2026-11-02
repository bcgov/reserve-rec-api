'use strict';

const { Template, Match } = require('aws-cdk-lib/assertions');
const apigw = require('aws-cdk-lib/aws-apigateway');

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const lambdaLib = require('aws-cdk-lib/aws-lambda');
  class NodejsFunction extends lambdaLib.Function {
    constructor(scope, id, { code, ...props }) {
      super(scope, id, { ...props, code: lambdaLib.Code.fromInline('exports.handler = async () => ({})') });
    }
  }
  return { NodejsFunction };
});

const { testStack } = require('../helpers/cdkConstruct');
const { AdminAuthorizerConstruct, PublicAuthorizerConstruct } = require('../../src/handlers/authorizers/constructs');

// An authorizer only synthesizes once a RestApi method uses it.
function build(Construct, id, environment) {
  const stack = testStack();
  const c = new Construct(stack, id, { environment });
  new apigw.RestApi(stack, 'Api').root.addMethod('GET', new apigw.MockIntegration(), { authorizer: c.getRequestAuthorizer() });
  return { c, t: Template.fromStack(stack) };
}

describe('authorizer constructs', () => {
  it('admin authorizer keys on the Authorization header and never caches a decision', () => {
    const { c, t } = build(AdminAuthorizerConstruct, 'AdminAuthorizer', { ADMIN_USER_POOL_ID: 'ca-central-1_admin' });
    expect(c.getRequestAuthorizer()).toBe(c.adminRequestAuthorizer);
    t.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Type: 'REQUEST',
      IdentitySource: 'method.request.header.Authorization',
      AuthorizerResultTtlInSeconds: 0,
    });
    t.hasResourceProperties('AWS::Lambda::Function', { Handler: 'admin.handler', Environment: { Variables: { ADMIN_USER_POOL_ID: 'ca-central-1_admin' } } });
  });

  it('public authorizer runs for every request, including ones without a token', () => {
    const { c, t } = build(PublicAuthorizerConstruct, 'PublicAuthorizer', { PUBLIC_USER_POOL_ID: 'ca-central-1_pub' });
    expect(c.getRequestAuthorizer()).toBe(c.publicRequestAuthorizer);
    t.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      IdentitySource: 'context.requestId',
      AuthorizerResultTtlInSeconds: 0,
    });
  });

  it('public authorizer may call AdminGetUser on its own pool only and writes the token-networks table', () => {
    const { t } = build(PublicAuthorizerConstruct, 'PublicAuthorizer', { PUBLIC_USER_POOL_ID: 'ca-central-1_pub' });

    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
        Action: 'cognito-idp:AdminGetUser',
        Resource: { 'Fn::Join': ['', Match.arrayWith([':cognito-idp:ca-central-1:111111111111:userpool/ca-central-1_pub'])] },
      })]) },
    });
    const grants = (action) => ({ PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith([action]) })]) } });
    t.hasResourceProperties('AWS::IAM::Policy', grants('dynamodb:PutItem'));
    t.hasResourceProperties('AWS::IAM::Policy', grants('dynamodb:Query'));
    t.hasResourceProperties('AWS::DynamoDB::Table', { TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true } });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'public.handler',
      Environment: { Variables: { PUBLIC_USER_POOL_ID: 'ca-central-1_pub', TOKEN_NETWORKS_TABLE: Match.anyValue() } },
    });
  });

  it('public authorizer without a pool id falls back to any pool', () => {
    const { t } = build(PublicAuthorizerConstruct, 'PublicAuthorizer', {});
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: 'cognito-idp:AdminGetUser', Resource: '*' })]) },
    });
  });
});
