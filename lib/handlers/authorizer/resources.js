/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Duration } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../../tools/bundling/yarnBundler');
const path = require('path');


function authorizerSetup(scope, props) {
  console.log('Authorizer Lambda setup...');

  // Authorizer lambda
  const authFunctionEntry = path.join(__dirname, '../authorizer');
  console.log('authFunctionEntry:', authFunctionEntry);
  const authFunction = new NodejsFunction(scope, 'AuthorizerFunction', {
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
    handler: 'index.handler',
    runtime: Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    description: 'Authorizer Lambda for the Reserve Rec API',
    timeout: Duration.seconds(10),
  });

  return {
    authFunction: authFunction
  };
}

module.exports = {
  authorizerSetup
};