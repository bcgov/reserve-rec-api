'use strict';

const { App, Stack } = require('aws-cdk-lib');
const { Template, Match } = require('aws-cdk-lib/assertions');
const { addUserPoolWebAcl, siteOrigins, loginUrl } = require('../lib/public-identity-stack/user-pool-web-acl');

const CALLBACKS = [
  'http://localhost:4300',
  'http://localhost:4300/',
  'https://abc123.cloudfront.net',
  'https://abc123.cloudfront.net/',
  'https://site.example/dayuse',
  'https://site.example/dayuse/',
];
const POOL_ARN = 'arn:aws:cognito-idp:ca-central-1:111111111111:userpool/ca-central-1_test';

function synth(props = {}) {
  const stack = new Stack(new App(), 'Test');
  addUserPoolWebAcl(stack, {
    webAclId: 'Test-UserPoolWebAcl',
    associationId: 'Test-UserPoolWebAclAssociation',
    userPoolArn: POOL_ARN,
    callbackUrls: CALLBACKS,
    ...props,
  });
  return Template.fromStack(stack);
}

const rules = (template) => Object.values(template.findResources('AWS::WAFv2::WebACL'))[0].Properties.Rules;
const rule = (template, name) => rules(template).find((r) => r.Name === name);

describe('siteOrigins', () => {
  it('dedupes callback URLs down to their origins, localhost included', () => {
    expect(siteOrigins(CALLBACKS)).toEqual([
      'http://localhost:4300',
      'https://abc123.cloudfront.net',
      'https://site.example',
    ]);
  });
});

describe('loginUrl', () => {
  it('prefers a callback that is neither localhost nor a CloudFront domain', () => {
    expect(loginUrl(CALLBACKS)).toBe('https://site.example/dayuse/login?bcsc=retry');
  });

  it('falls back to a CloudFront domain, then localhost', () => {
    expect(loginUrl(CALLBACKS.slice(0, 4))).toBe('https://abc123.cloudfront.net/login?bcsc=retry');
    expect(loginUrl(['http://localhost:4200'])).toBe('http://localhost:4200/login?bcsc=retry');
  });
});

describe('user pool web ACL', () => {
  const template = synth({ signUpRateLimit: 100 });

  it('is regional, allows by default and associates with the pool', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Name: 'Test-UserPoolWebAcl',
      Scope: 'REGIONAL',
      DefaultAction: { Allow: {} },
      VisibilityConfig: { CloudWatchMetricsEnabled: true, SampledRequestsEnabled: true },
    });
    template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', {
      ResourceArn: POOL_ARN,
      WebACLArn: { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] },
    });
  });

  it('orders the rules and records metrics and samples for each', () => {
    expect(rules(template).map((r) => [r.Name, r.Priority])).toEqual([
      ['HostedPages', 0], ['SignUpOrigin', 1], ['SignUpRate', 2],
    ]);
    for (const r of rules(template)) {
      expect(r.VisibilityConfig).toEqual({ CloudWatchMetricsEnabled: true, MetricName: r.Name, SampledRequestsEnabled: true });
    }
  });

  it('redirects the hosted pages to the site login page', () => {
    const r = rule(template, 'HostedPages');
    const regex = new RegExp(r.Statement.RegexMatchStatement.RegexString);
    for (const p of ['/login', '/signup', '/forgotpassword', '/confirmforgotpassword', '/login/']) {
      expect(regex.test(p)).toBe(true);
    }
    for (const p of ['/logout', '/oauth2/authorize', '/oauth2/idpresponse', '/confirm', '/']) {
      expect(regex.test(p)).toBe(false);
    }
    expect(r.Statement.RegexMatchStatement.TextTransformations.map((t) => t.Type)).toEqual(['URL_DECODE', 'LOWERCASE']);
    expect(r.Action.Block.CustomResponse).toEqual({
      ResponseCode: 302,
      ResponseHeaders: [{ Name: 'Location', Value: 'https://site.example/dayuse/login?bcsc=retry' }],
    });
  });

  it('blocks sign-up unless the origin is one of the site origins', () => {
    const r = rule(template, 'SignUpOrigin');
    const [signUp, notOrigin] = r.Statement.AndStatement.Statements;
    const headers = (s) => s.OrStatement.Statements.map((x) => [
      x.ByteMatchStatement.FieldToMatch.SingleHeader.name,
      x.ByteMatchStatement.SearchString,
      x.ByteMatchStatement.PositionalConstraint,
    ]);
    expect(headers(signUp)).toEqual([
      ['x-amz-target', 'AWSCognitoIdentityProviderService.SignUp', 'EXACTLY'],
      ['x-amzn-cognito-operation-name', 'SignUp', 'EXACTLY'],
    ]);
    expect(headers(notOrigin.NotStatement.Statement)).toEqual(
      siteOrigins(CALLBACKS).map((o) => ['origin', o, 'EXACTLY']));
    expect(r.Action).toEqual({ Block: {} });
  });

  it('rate limits sign-up per IP', () => {
    const r = rule(template, 'SignUpRate');
    expect(r.Statement.RateBasedStatement).toEqual({
      Limit: 100,
      AggregateKeyType: 'IP',
      ScopeDownStatement: rule(template, 'SignUpOrigin').Statement.AndStatement.Statements[0],
    });
    expect(r.Action).toEqual({ Block: {} });
  });

  it('matches a single origin without an OR', () => {
    const r = rule(synth({ callbackUrls: ['https://site.example/dayuse'] }), 'SignUpOrigin');
    expect(r.Statement.AndStatement.Statements[1].NotStatement.Statement.ByteMatchStatement.SearchString)
      .toBe('https://site.example');
  });
});

describe('sign-up rate limit config', () => {
  it.each([undefined, null, ''])('omits the rate rule when unset (%p)', (value) => {
    expect(rules(synth({ signUpRateLimit: value })).map((r) => r.Name)).toEqual(['HostedPages', 'SignUpOrigin']);
  });

  it('accepts a numeric string from SSM', () => {
    expect(rule(synth({ signUpRateLimit: '50' }), 'SignUpRate').Statement.RateBasedStatement.Limit).toBe(50);
  });

  it.each(['abc', 5, 12.5])('rejects %p', (value) => {
    expect(() => synth({ signUpRateLimit: value })).toThrow(/publicSignUpRateLimit/);
  });
});
