const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require('aws-cdk-lib/aws-iam');

const defaults = {
  resources: {
    migrateMigIdPutFunction: {
      name: 'MigrateMigIdPUT',
    },
  }
};

class PublicMigrateConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // Add /migrate resource
    this.migrateResource = this.resolveApi().root.addResource('migrate');

    // Add /migrate/{migrateId} resource
    this.migrateMigrateIdResource = this.migrateResource.addResource('{migrateId}');

    this.addCorsPreflightForResources([
      this.migrateResource,
      this.migrateMigrateIdResource,
    ]);

    this.migrateMigrateIdPutFunction = this.generateBasicLambdaFn(
      scope,
      'migrateMigIdPutFunction',
      'src/handlers/migrate/PUT',
      'public.handler',
      {
        transDataBasicReadWrite: true,
      }
    );
    this.migrateMigrateIdPutFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:TransactWriteItems'],
      resources: [this.getTransactionalDataTableArn()],
    }));

    // PUT /migrate/{migrateId}
    this.migrateMigrateIdResource.addMethod('PUT', new apigw.LambdaIntegration(this.migrateMigrateIdPutFunction), {
      authorizationType: apigw.AuthorizationType.NONE,
    });
  }
}

module.exports = {
  PublicMigrateConstruct
};
