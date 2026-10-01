const wafv2 = require('aws-cdk-lib/aws-wafv2');

const HOSTED_PAGES = ['login', 'signup', 'forgotpassword', 'confirmforgotpassword'];

const isLocalhost = (url) => ['localhost', '127.0.0.1'].includes(url.hostname);

function siteOrigins(callbackUrls) {
  return [...new Set(callbackUrls.map((u) => new URL(u).origin))];
}

// Front-door URL first, then any other deployed URL, then localhost.
function loginUrl(callbackUrls) {
  const rank = (url) => (isLocalhost(url) ? 2 : url.hostname.endsWith('.cloudfront.net') ? 1 : 0);
  const [site] = callbackUrls.map((u) => new URL(u)).sort((a, b) => rank(a) - rank(b));
  return `${site.origin}${site.pathname.replace(/\/+$/, '')}/login?bcsc=retry`;
}

function parseRateLimit(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 10) {
    throw new Error(`publicSignUpRateLimit must be an integer of at least 10, got ${value}`);
  }
  return limit;
}

const headerEquals = (name, value) => ({
  byteMatchStatement: {
    fieldToMatch: { singleHeader: { name } },
    positionalConstraint: 'EXACTLY',
    searchString: value,
    textTransformations: [{ priority: 0, type: 'NONE' }],
  },
});

const anyOf = (statements) => (statements.length === 1 ? statements[0] : { orStatement: { statements } });

const visibility = (metricName) => ({
  cloudWatchMetricsEnabled: true,
  metricName,
  sampledRequestsEnabled: true,
});

const SIGN_UP = anyOf([
  headerEquals('x-amz-target', 'AWSCognitoIdentityProviderService.SignUp'),
  headerEquals('x-amzn-cognito-operation-name', 'SignUp'),
]);

/**
 * Regional web ACL on a Cognito user pool.
 * @param {object} props
 * @param {string} props.webAclId - construct id and name of the web ACL
 * @param {string} props.associationId - construct id of the association
 * @param {string} props.userPoolArn
 * @param {string[]} props.callbackUrls - the app client's callback URLs
 * @param {number|string} [props.signUpRateLimit] - unset omits the SignUpRate rule
 */
function addUserPoolWebAcl(scope, { webAclId, associationId, userPoolArn, callbackUrls, signUpRateLimit }) {
  const rateLimit = parseRateLimit(signUpRateLimit);
  const rules = [
    {
      name: 'HostedPages',
      statement: {
        regexMatchStatement: {
          fieldToMatch: { uriPath: {} },
          regexString: `^/(${HOSTED_PAGES.join('|')})/?$`,
          textTransformations: [
            { priority: 0, type: 'URL_DECODE' },
            { priority: 1, type: 'LOWERCASE' },
          ],
        },
      },
      // Answers with a redirect to the site's login page.
      action: {
        block: {
          customResponse: {
            responseCode: 302,
            responseHeaders: [{ name: 'Location', value: loginUrl(callbackUrls) }],
          },
        },
      },
    },
    {
      name: 'SignUpOrigin',
      statement: {
        andStatement: {
          statements: [
            SIGN_UP,
            { notStatement: { statement: anyOf(siteOrigins(callbackUrls).map((o) => headerEquals('origin', o))) } },
          ],
        },
      },
      action: { block: {} },
    },
    ...(rateLimit ? [{
      name: 'SignUpRate',
      statement: {
        rateBasedStatement: {
          limit: rateLimit,
          aggregateKeyType: 'IP',
          scopeDownStatement: SIGN_UP,
        },
      },
      action: { block: {} },
    }] : []),
  ].map((rule, priority) => ({ ...rule, priority, visibilityConfig: visibility(rule.name) }));

  const webAcl = new wafv2.CfnWebACL(scope, webAclId, {
    name: webAclId,
    scope: 'REGIONAL',
    defaultAction: { allow: {} },
    visibilityConfig: visibility(`${webAclId}Metrics`),
    rules,
  });

  new wafv2.CfnWebACLAssociation(scope, associationId, {
    resourceArn: userPoolArn,
    webAclArn: webAcl.attrArn,
  });
}

module.exports = { addUserPoolWebAcl, siteOrigins, loginUrl };
