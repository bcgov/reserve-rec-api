/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Duration } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../../tools/bundling/yarnBundler');

function createAuthorizerFunction(scope, id, props) {
  // Import base layers

  // Authorizer lambda
  const authorizerFn = new NodejsFunction(scope, id, {
    code: Code.fromAsset(props?.authFunctionEntry, {
      bundling: {
        image: Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(props?.authFunctionEntry, outputDir, props);
          }
        }
      }
    }),
    handler: props?.handler,
    runtime: Runtime.NODEJS_20_X,
    environment: {
      ...props?.environment,
      ADMIN_USER_POOL_ID: 'ca-central-1_t217sRc7O',
      ADMIN_USER_POOL_CLIENT_ID: '36ie4cklr6aht6r4ksdm51ich1',
      // ADMIN_USER_POOL_ID: adminUserPoolId,
      // ADMIN_USER_POOL_CLIENT_ID: adminUserPoolClientId,
    },
    functionName: id,
    description: props?.description || `Authorizer function for ${props?.APP_NAME}: ${props?.STACK_NAME} - ${props?.ENVIRONMENT_NAME} environment`,
    timeout: Duration.seconds(10),
    layers: props?.layers,
  });

  return authorizerFn;
};

module.exports = {
  createAuthorizerFunction
};