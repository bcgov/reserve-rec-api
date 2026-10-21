/**
 * CDK Resources for the Authorizer Lambda.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const apigw = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const { Duration, RemovalPolicy, Stack } = require('aws-cdk-lib');
const { Code, Runtime } = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../../scripts/tools/bundling/yarnBundler');
const { Construct } = require('constructs');
const path = require('path');
const { EVENT_LOG_RETENTION, addEventMetrics, eventMetricNamespace } = require('../../../lib/helpers/event-metrics');

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
          image: Runtime.NODEJS_22_X.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir) {
              return buildDist(authFunctionEntry, outputDir, props?.environment);
            }
          }
        }
      }),
      handler: 'admin.handler',
      runtime: Runtime.NODEJS_22_X,
      environment: props?.environment,
      functionName: `${scope.getAppName()}-${scope.getDeploymentName()}-${constructId}`.slice(0, 64),
      description: props?.description || `Admin Authorizer function for ${scope.getAppName()}-${scope.getDeploymentName()} environment`,
      timeout: Duration.seconds(10),
      layers: props?.layers,
    });

    const requestAuthorizerId = scope.createScopedId(id, 'RequestAuthorizer');
    this.adminRequestAuthorizer = new apigw.RequestAuthorizer(this, requestAuthorizerId, {
      authorizerName: requestAuthorizerId,
      handler: this.adminAuthorizerFunction,
      identitySources: [apigw.IdentitySource.header('Authorization')],
      // TTL is currently disabled to ensure each request is freshly authorized.
      resultsCacheTtl: Duration.seconds(0), // TODO: set to 5 mins to not hit authorizer on every request
    });

  }

  getRequestAuthorizer() {
    return this.adminRequestAuthorizer;
  }
}

class PublicAuthorizerConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    // One item per token subject and client network, expired by TTL.
    this.tokenNetworksTable = new dynamodb.Table(this, scope.createScopedId(id, 'TokenNetworksTable'), {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const environment = { ...props?.environment, TOKEN_NETWORKS_TABLE: this.tokenNetworksTable.tableName };

    // Create the Authorizer Lambda function
    const functionId = scope.createScopedId(id, 'Function');
    const authFunctionEntry = path.join(__dirname, '');
    this.publicAuthorizerFunction = new NodejsFunction(this, functionId, {
      code: Code.fromAsset(authFunctionEntry, {
        bundling: {
          image: Runtime.NODEJS_22_X.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir) {
              return buildDist(authFunctionEntry, outputDir, props?.environment);
            }
          }
        }
      }),
      handler: 'public.handler',
      runtime: Runtime.NODEJS_22_X,
      environment,
      functionName: `${scope.getAppName()}-${scope.getDeploymentName()}-${constructId}`.slice(0, 64),
      description: props?.description || `Public Authorizer function for ${scope.getAppName()}-${scope.getDeploymentName()} environment`,
      timeout: Duration.seconds(10),
      layers: props?.layers,
      logRetention: EVENT_LOG_RETENTION,
    });

    // Availability reads check the caller's account with AdminGetUser.
    const userPoolId = props?.environment?.PUBLIC_USER_POOL_ID;
    this.publicAuthorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPoolId
        ? Stack.of(this).formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: userPoolId })
        : '*'],
    }));
    this.tokenNetworksTable.grantReadWriteData(this.publicAuthorizerFunction);
    addEventMetrics(this.publicAuthorizerFunction, eventMetricNamespace(scope.getDeploymentName()), ['availability_denied', 'token_network_spread', 'viewer_ip_missing']);

    const requestAuthorizerId = scope.createScopedId(id, 'RequestAuthorizer');
    this.publicRequestAuthorizer = new apigw.RequestAuthorizer(this, requestAuthorizerId, {
      authorizerName: requestAuthorizerId,
      handler: this.publicAuthorizerFunction,
      // TODO: Temporary solution(?)
      // Use requestId rather than the Authorization header so that
      // unauthenticated requests are still forwarded to the Lambda.
      identitySources: [apigw.IdentitySource.context('requestId')],
      // TTL is currently disabled to ensure each request is freshly authorized.
      resultsCacheTtl: Duration.seconds(0),
    });

  }

  getRequestAuthorizer() {
    return this.publicRequestAuthorizer;
  }
}

module.exports = {
  AdminAuthorizerConstruct,
  PublicAuthorizerConstruct
};
