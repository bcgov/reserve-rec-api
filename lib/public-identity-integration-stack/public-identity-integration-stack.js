const { Duration, CustomResource } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const cr = require('aws-cdk-lib/custom-resources');
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { logger } = require('../helpers/utils');

const defaults = {
  description: 'Public Identity Integration stack managing Cognito triggers and cross-stack identity integrations for the Reserve Recreation APIs.',
  constructs: {
    newUserRegisterFunction: {
      name: 'PostConfirm',
    },
  },
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

async function createPublicIdentityIntegrationStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new PublicIdentityIntegrationStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Public Identity Integration Stack: ${error}`);
  }
}

class PublicIdentityIntegrationStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Public Identity Integration Stack: ${this.stackId}`);

    // Resolve dependencies from other stacks
    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);
    const transDataTableName = scope.resolveTransDataTableName(this);
    const transDataTableArn = scope.resolveTransDataTableArn(this);
    const publicUserPoolId = scope.resolvePublicUserPoolId(this);

    // POST_CONFIRMATION trigger - write new users to DynamoDB
    this.newUserRegisterFunction = new lambda.Function(this, this.getConstructId('newUserRegisterFunction'), {
      functionName: this.getConstructId('newUserRegisterFunction'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('lib/handlers/cognitoTriggers/postConfirmation'),
      timeout: Duration.seconds(10),
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      environment: {
        TRANSACTIONAL_DATA_TABLE_NAME: transDataTableName,
        LOG_LEVEL: this.getConfigValue('logLevel')
      },
    });

    // Grant DynamoDB permissions to POST_CONFIRMATION trigger
    this.newUserRegisterFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      resources: [transDataTableArn]
    }));

    // Grant Cognito permission to invoke the Lambda
    this.newUserRegisterFunction.addPermission('CognitoInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${publicUserPoolId}`,
    });

    const updateUserPoolTrigger = new cr.AwsCustomResource(this, 'UpdateUserPoolTrigger', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPool',
        parameters: {
          UserPoolId: publicUserPoolId,
          LambdaConfig: {
            PostConfirmation: this.newUserRegisterFunction.functionArn
          }
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${publicUserPoolId}-post-confirmation-trigger`)
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPool',
        parameters: {
          UserPoolId: publicUserPoolId,
          LambdaConfig: {
            PostConfirmation: this.newUserRegisterFunction.functionArn
          }
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${publicUserPoolId}-post-confirmation-trigger`)
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cognito-idp:UpdateUserPool', 'cognito-idp:DescribeUserPool'],
          resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${publicUserPoolId}`]
        })
      ])
    });

    // Ensure Custom Resource runs after Lambda is created
    updateUserPoolTrigger.node.addDependency(this.newUserRegisterFunction);

    logger.info(`POST_CONFIRMATION trigger configured for User Pool: ${publicUserPoolId}`);
  }
}

module.exports = {
  createPublicIdentityIntegrationStack,
};
