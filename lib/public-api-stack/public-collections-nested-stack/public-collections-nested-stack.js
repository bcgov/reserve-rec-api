'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PublicCollectionsConstruct } = require('../../../src/handlers/collections/constructs');

class PublicCollectionsNestedStack extends NestedStack {
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

    this.collectionsConstruct = new PublicCollectionsConstruct(this, 'Collections', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
    });
  }
}

module.exports = { PublicCollectionsNestedStack };
