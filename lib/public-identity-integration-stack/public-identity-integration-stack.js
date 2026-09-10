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
    preSignUpFunction: {
      name: 'PreSignUp',
    },
    attachTriggersFunction: {
      name: 'AttachTriggers',
    },
  },
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
    // Blocked addresses, domains and structural patterns. The list is defence
    // data and lives in SSM, per environment — never in a repository. Override
    // per environment to point at a different list.
    blocklistSsmParam: '',
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

    // Skip mode: sandbox environments share Dev's user pool and must not overwrite its
    // Lambda triggers with a sandbox-specific function.
    if (this.overrides?.skipCreation === true) {
      logger.info('Skip mode enabled: Skipping Lambda trigger creation to protect the shared Dev user pool.');
      return;
    }

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
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      resources: [transDataTableArn]
    }));

    // Grant Cognito write permission so the trigger can force email_verified=true
    // for BCSC federated users (Cognito resets it on every login when email is mapped).
    this.newUserRegisterFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:AdminUpdateUserAttributes'],
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${publicUserPoolId}`]
    }));

    // The list is per environment. Note the payload outgrew SSM's 4KB standard
    // tier on the first seed and sits on Advanced (8KB); it will need a real
    // store before it doubles.
    const blocklistParam = this.getConfigValue('blocklistSsmParam')
      || `/reserveRecApi/${this.getDeploymentName()}/signup/emailBlocklist`;

    // PRE_SIGN_UP trigger - refuse account creation for blocked addresses.
    // DUP enforced this as 20 regex rules on the WAF because the address
    // arrived in an unauthenticated request body. Here it is an account
    // attribute, so the check belongs at signup, where it survives an IP change
    // and where the person can be told something.
    this.preSignUpFunction = new lambda.Function(this, this.getConstructId('preSignUpFunction'), {
      functionName: this.getConstructId('preSignUpFunction'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('lib/handlers/cognitoTriggers/preSignUp'),
      timeout: Duration.seconds(5),
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      environment: {
        BLOCKLIST_SSM_PARAM: blocklistParam,
        LOG_LEVEL: this.getConfigValue('logLevel')
      },
    });

    this.preSignUpFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${blocklistParam}`]
    }));

    this.preSignUpFunction.addPermission('CognitoInvokePreSignUpPermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${publicUserPoolId}`,
    });

    // Grant Cognito permission to invoke the Lambda
    this.newUserRegisterFunction.addPermission('CognitoInvokePermission', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${publicUserPoolId}`,
    });

    // Attaching a trigger means calling UpdateUserPool, which REPLACES the whole
    // pool configuration — every field not passed back is reset to its default.
    // A fixed AwsCustomResource cannot do that safely, because the live config
    // is not knowable at synth time. This resource reads the pool, merges the
    // triggers into whatever is already there, and writes everything back.
    //
    // The previous version passed UserPoolId and LambdaConfig alone. The first
    // time it re-ran it cleared AutoVerifiedAttributes on dev and test, and was
    // rejected in prod because the resulting state was invalid — which is the
    // only reason prod escaped it.
    this.attachTriggersFunction = new lambda.Function(this, this.getConstructId('attachTriggersFunction'), {
      functionName: this.getConstructId('attachTriggersFunction'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset('lib/handlers/cognitoTriggers/attachTriggers'),
      timeout: Duration.minutes(2),
    });

    this.attachTriggersFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['cognito-idp:UpdateUserPool', 'cognito-idp:DescribeUserPool'],
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${publicUserPoolId}`]
    }));

    // Echoing SmsConfiguration back means passing its SnsCallerArn, and
    // UpdateUserPool refuses that without iam:PassRole on the role. Scoped by
    // the service the role is passed to rather than by name, because the role
    // is environment-specific and prod has no SMS configuration at all.
    this.attachTriggersFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [`arn:aws:iam::${this.account}:role/*`],
      conditions: { StringEquals: { 'iam:PassedToService': 'cognito-idp.amazonaws.com' } }
    }));

    const attachTriggersProvider = new cr.Provider(this, 'AttachTriggersProvider', {
      onEventHandler: this.attachTriggersFunction,
    });

    const updateUserPoolTrigger = new CustomResource(this, 'UpdateUserPoolTrigger', {
      serviceToken: attachTriggersProvider.serviceToken,
      properties: {
        UserPoolId: publicUserPoolId,
        Triggers: {
          PreTokenGeneration: this.newUserRegisterFunction.functionArn,
          PreSignUp: this.preSignUpFunction.functionArn,
        },
      },
    });

    // Ensure Custom Resource runs after Lambda is created
    updateUserPoolTrigger.node.addDependency(this.newUserRegisterFunction);
    updateUserPoolTrigger.node.addDependency(this.preSignUpFunction);

    logger.info(`PRE_TOKEN_GENERATION and PRE_SIGN_UP triggers configured for User Pool: ${publicUserPoolId}`);
  }
}

module.exports = {
  createPublicIdentityIntegrationStack,
};
