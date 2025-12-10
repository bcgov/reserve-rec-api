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
      functionName: `${scope.stackName}-BCSCGetHandler`,
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
      functionName: `${scope.stackName}-BCSCPostHandler`,
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
    const jwksResource = bcscResource.addResource('jwks');
    jwksResource.addMethod('GET', new apigw.LambdaIntegration(this.bcscGetHandler));

    const userinfoResource = bcscResource.addResource('userinfo');
    const envResource = userinfoResource.addResource('{env}');

    envResource.addMethod('GET', new apigw.LambdaIntegration(this.bcscGetHandler));
    envResource.addMethod('POST', new apigw.LambdaIntegration(this.bcscPostHandler));
  }
}

module.exports = {
  BCSCConstruct,
};