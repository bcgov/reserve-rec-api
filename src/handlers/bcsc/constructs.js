const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { Construct } = require('constructs');
const path = require('path');

class BCSCConstruct extends Construct {
  constructor(scope, id, props) {
    super(scope, id);

    const {
      environment = {},
      layers = [],
      api,
    } = props;

    if (!api) {
      throw new Error('BCSCConstruct: Missing required property "api" in props');
    }

    // Shorten function names to stay under 64 character Lambda limit
    const appName = scope.getAppName?.() || 'App';
    const deploymentName = scope.getDeploymentName?.() || 'Dev';
    const functionNameBase = `${appName}-${deploymentName}-bcsc`.slice(0, 48); // Leave room for suffix

    // BCSC GET Handler
    this.bcscGetHandler = new lambda.Function(this, 'BCSCGetHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'GET')),
      layers: layers,
      environment: {
        ...environment,
        LOG_LEVEL: environment.LOG_LEVEL || 'info',
      },
      timeout: Duration.seconds(30),
      memorySize: 256,
      functionName: `${functionNameBase}-get`.slice(0, 64),
    });

    // BCSC POST Handler
    this.bcscPostHandler = new lambda.Function(this, 'BCSCPostHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'POST')),
      layers: layers,
      environment: {
        ...environment,
        LOG_LEVEL: environment.LOG_LEVEL || 'info',
      },
      timeout: Duration.seconds(30),
      memorySize: 256,
      functionName: `${functionNameBase}-post`.slice(0, 64),
    });

    // Add KMS permissions for both handlers
    const kmsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:DescribeKey',
        'kms:GetPublicKey',
      ],
      resources: ['*'],
    });

    this.bcscGetHandler.addToRolePolicy(kmsPolicy);
    this.bcscPostHandler.addToRolePolicy(kmsPolicy);

    // Add Secrets Manager permissions if using secrets
    const secretsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
      ],
      resources: ['*'],
    });

    this.bcscGetHandler.addToRolePolicy(secretsPolicy);
    this.bcscPostHandler.addToRolePolicy(secretsPolicy);

    // Create /bcsc resource
    const bcscResource = api.root.addResource('bcsc');

    // GET /bcsc/jwks - Public key endpoint
    const jwksResource = bcscResource.addResource('jwks');
    jwksResource.addMethod('GET', new apigw.LambdaIntegration(this.bcscGetHandler));

    // /bcsc/userinfo/{env}
    const userinfoResource = bcscResource.addResource('userinfo');
    const userinfoEnvResource = userinfoResource.addResource('{env}');
    
    // GET /bcsc/userinfo/{env}
    userinfoEnvResource.addMethod('GET', new apigw.LambdaIntegration(this.bcscGetHandler));

    // bcsc/token/{env} - Token exchange endpoint
    const tokenResource = bcscResource.addResource('token');
    const tokenEnvResource = tokenResource.addResource('{env}');

    [bcscResource, jwksResource, userinfoResource, userinfoEnvResource, tokenResource, tokenEnvResource]
      .forEach((resource) => {
        resource.addCorsPreflight({
          allowCredentials: true,
          allowOrigins: apigw.Cors.ALL_ORIGINS,
          allowMethods: apigw.Cors.ALL_METHODS,
          allowHeaders: [
            'Content-Type',
            'X-Amz-Date',
            'Authorization',
            'X-Api-Key',
            'X-Amz-Security-Token',
          ],
        });
      });
    
    // POST /bcsc/token/{env} - Token exchange (used by Cognito)
    tokenEnvResource.addMethod('POST', new apigw.LambdaIntegration(this.bcscPostHandler));
  }
}

module.exports = {
  BCSCConstruct,
};
