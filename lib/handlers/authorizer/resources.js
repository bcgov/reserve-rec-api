/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Duration } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');


function authorizerSetup(scope, props) {
  console.log('Authorizer Lambda setup...');

  // Authorizer lambda
  const authFunction = new NodejsFunction(scope, 'AuthorizerFunction', {
    code: Code.fromAsset('lib/handlers/authorizer'),
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