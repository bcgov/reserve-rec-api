/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const apigw = require('aws-cdk-lib/aws-apigateway');
const { Duration } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../../tools/bundling/yarnBundler');
const { Construct } = require('constructs');
const path = require('path');

class AdminAuthorizerConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    // Create the Authorizer Lambda function
    const functionId = scope.createScopedId(id, 'Function');
    const authFunctionEntry = path.join(__dirname, '');
    this.adminAuthorizerFunction = new NodejsFunction(this, functionId, {
      code: Code.fromAsset(authFunctionEntry, {
        bundling: {
          image: Runtime.NODEJS_20_X.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir) {
              buildDist(authFunctionEntry, outputDir, props?.environment);
            }
          }
        }
      }),
      handler: 'admin.handler',
      runtime: Runtime.NODEJS_20_X,
      environment: props?.environment,
      functionName: constructId,
      description: props?.description || `Authorizer function for ${scope.getAppName()}-${scope.getDeploymentName()} environment`,
      timeout: Duration.seconds(10),
      layers: props?.layers,
    });

    const requestAuthorizerId = scope.createScopedId(id, 'RequestAuthorizer');
    this.adminRequestAuthorizer = new apigw.RequestAuthorizer(this, requestAuthorizerId, {
      authorizerName: requestAuthorizerId,
      handler: this.adminAuthorizerFunction,
      identitySources: [apigw.IdentitySource.header('Authorization')],
    });

  }

  getRequestAuthorizer() {
    return this.adminRequestAuthorizer;
  }
}

module.exports = {
  AdminAuthorizerConstruct,
};