'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PublicMigrateConstruct } = require('../../../src/handlers/migrate/constructs');

class PublicMigrateNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.getAppName = scope.getAppName;
    this.getDeploymentName = scope.getDeploymentName;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubCOL`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.migrateConstruct = new PublicMigrateConstruct(this, 'Migrate', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      emailQueueUrl: props.emailQueueUrl,
      emailQueueArn: props.emailQueueArn,
      publicFrontendDomain: props.publicFrontendDomain,
      emailClaimTableName: props.emailClaimTableName,
      emailClaimTableArn: props.emailClaimTableArn,
      publicUserPoolId: props.publicUserPoolId,
      publicUserPoolArn: props.publicUserPoolArn,
      kmsKey: props.kmsKey,
      transactionalDataTableArn: props.transactionalDataTableArn,
    });
  }
}

module.exports = { PublicMigrateNestedStack };
