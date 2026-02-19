const { Duration } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { logger } = require('../helpers/utils');

const defaults = {
  description: 'Public Identity Integration stack managing Cognito triggers and cross-stack identity integrations for the Reserve Recreation APIs.',
  constructs: {
    newUserRegisterFunction: {
      name: 'NewUserRegisterFunction',
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

    // Import existing User Pool
    const publicUserPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedPublicUserPool',
      publicUserPoolId
    );

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

    // Attach POST_CONFIRMATION trigger to User Pool
    publicUserPool.addTrigger(
      cognito.UserPoolOperation.POST_CONFIRMATION,
      this.newUserRegisterFunction
    );

    logger.info(`POST_CONFIRMATION trigger attached to User Pool: ${publicUserPoolId}`);
  }
}

module.exports = {
  createPublicIdentityIntegrationStack,
};
