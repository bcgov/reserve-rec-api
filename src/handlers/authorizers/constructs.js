/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Duration } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../../tools/bundling/yarnBundler');
const path = require('path');
const { resolveBaseLayer } = require("../../layers/resolvers");

function createAuthorizerFunction(scope, id, props) {
  // Import base layers
  const baseLayer = resolveBaseLayer(scope, props);

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
    environment: props?.environment,
    functionName: id,
    description: props?.description || `Authorizer function for ${props?.APP_NAME}: ${props?.STACK_NAME} - ${props?.ENVIRONMENT_NAME} environment`,
    timeout: Duration.seconds(10),
    layers: [baseLayer],
  });

  return authorizerFn;
};

module.exports = {
  createAuthorizerFunction
};