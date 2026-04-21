'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PublicSearchLambda } = require('../../../src/handlers/search/constructs');

/**
 * NestedStack for Public Search API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 */
class PublicSearchNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubSRCH`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.publicSearchConstruct = new PublicSearchLambda(this, 'PublicSearch', {
      opensearchDomainArn: props.opensearchDomainArn,
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
    });
  }
}

module.exports = { PublicSearchNestedStack };
