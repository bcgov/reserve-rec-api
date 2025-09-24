/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const apigateway = require('aws-cdk-lib/aws-apigateway');
const { Duration } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../../tools/bundling/yarnBundler');
const path = require('path');


function authorizerSetup(scope, props) {
  console.log('Authorizer Lambdas setup...');

  // Authorizer lambda
  const authFunctionEntry = path.join(__dirname, '../authorizer');
  const publicAuthFunction = new NodejsFunction(scope, 'PublicAuthorizerFunction', {
    code: Code.fromAsset(authFunctionEntry, {
      bundling: {
        image: Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(authFunctionEntry, outputDir, props);
          },
        }
      }
    }),
    handler: 'public.handler',
    runtime: Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    description: 'Public Authorizer Lambda for the Reserve Rec API',
    timeout: Duration.seconds(10),
  });

  const adminAuthFunction = new NodejsFunction(scope, 'AdminAuthorizerFunction', {
    code: Code.fromAsset(authFunctionEntry, {
      bundling: {
        image: Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(authFunctionEntry, outputDir, props);
          },
        }
      }
    }),
    handler: 'admin.handler',
    runtime: Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    description: 'Admin Authorizer Lambda for the Reserve Rec API',
    timeout: Duration.seconds(10),
  });

  // TOKEN AUTHORIZERS

  const publicRequestAuthorizer = new apigateway.RequestAuthorizer(scope, 'PublicRequestAuthorizer', {
    handler: publicAuthFunction,
    identitySources: [apigateway.IdentitySource.header('Authorization')],
    authorizerName: 'ReserveRecPublicAuthorizer',
  });

  const adminRequestAuthorizer = new apigateway.RequestAuthorizer(scope, 'AdminRequestAuthorizer', {
    handler: adminAuthFunction,
    identitySources: [apigateway.IdentitySource.header('Authorization')],
    authorizerName: 'ReserveRecAdminAuthorizer',
  });

  return {
    publicRequestAuthorizer: publicRequestAuthorizer,
    adminRequestAuthorizer: adminRequestAuthorizer
  };
}

module.exports = {
  authorizerSetup
};