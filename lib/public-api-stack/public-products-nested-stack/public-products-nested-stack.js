'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PublicProductsConstruct } = require('../../../src/handlers/products/constructs');

/**
 * NestedStack for Public Products API endpoints
 *
 * The API Gateway and Authorizer are passed by ID from the parent stack avoiding,
 * cross-stack CDK object references that were consuming root stack resources.
 */

class PublicProductsNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubPRD`;

    // Reconstruct the API reference from the imported IDs
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.publicProductsConstruct = new PublicProductsConstruct(this, 'PublicProducts', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { PublicProductsNestedStack };
