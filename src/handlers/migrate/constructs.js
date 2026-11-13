const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const { Duration } = require("aws-cdk-lib");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");

const defaults = {
  resources: {
    migrateEmailPostFunction: { name: "MigrateEmailPOST" },
    migrateConfirmPostFunction: { name: "MigrateConfirmPOST" },
  },
};

class PublicMigrateConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults,
    });

    // Add /migrate resource
    this.migrateResource = this.resolveApi().root.addResource("migrate");

    // Add /migrate/{migrateId} resource
    this.migrateMigrateIdResource =
      this.migrateResource.addResource("{migrateId}");
    this.migrateEmailResource =
      this.migrateMigrateIdResource.addResource("email");
    this.migrateConfirmResource = this.migrateResource.addResource("confirm");

    this.addCorsPreflightForResources([
      this.migrateResource,
      this.migrateMigrateIdResource,
      this.migrateEmailResource,
      this.migrateConfirmResource,
    ]);

    this.migrateEmailPostFunction = this.generateBasicLambdaFn(
      scope,
      "migrateEmailPostFunction",
      "src/handlers/migrate/POST",
      "sendEmail.handler",
      {
        memorySize: 512,
        timeout: Duration.seconds(20),
      },
    );

    this.migrateEmailPostFunction.addEnvironment(
      "EMAIL_QUEUE_URL",
      props.emailQueueUrl,
    );

    this.migrateEmailPostFunction.addEnvironment(
      "PUBLIC_FRONTEND_DOMAIN",
      props.publicFrontendDomain,
    );

    this.migrateEmailPostFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [
          props.transactionalDataTableArn,
          `${props.transactionalDataTableArn}/index/*`,
        ],
      }),
    );

    this.migrateEmailPostFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [props.emailQueueArn],
      }),
    );

    if (props.kmsKey) {
      this.migrateEmailPostFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["kms:Decrypt", "kms:GenerateDataKey"],
          resources: [props.kmsKey.keyArn],
        }),
      );
    }

    this.migrateEmailResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(this.migrateEmailPostFunction),
      {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.resolveAuthorizer(),
      },
    );

    this.migrateConfirmPostFunction = this.generateBasicLambdaFn(
      scope,
      "migrateConfirmPostFunction",
      "src/handlers/migrate/POST",
      "confirm.handler",
      {
        memorySize: 512,
        timeout: Duration.seconds(20),
      },
    );

    this.migrateConfirmPostFunction.addEnvironment(
      "CLAIM_TABLE_NAME",
      props.emailClaimTableName,
    );

    this.migrateConfirmPostFunction.addEnvironment(
      "PUBLIC_USER_POOL_ID",
      props.publicUserPoolId,
    );

    this.migrateConfirmPostFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [
          props.transactionalDataTableArn,
          `${props.transactionalDataTableArn}/index/*`,
        ],
      }),
    );

    this.migrateConfirmPostFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [props.emailClaimTableArn],
      }),
    );

    this.migrateConfirmPostFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminUpdateUserAttributes"],
        resources: [props.publicUserPoolArn],
      }),
    );

    this.migrateConfirmResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(this.migrateConfirmPostFunction),
      { authorizationType: apigw.AuthorizationType.NONE },
    );
  }
}

module.exports = {
  PublicMigrateConstruct
};
