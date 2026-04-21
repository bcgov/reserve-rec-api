'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { PublicFacilitiesConstruct } = require('../../../src/handlers/facilities/constructs');

/**
 * NestedStack for Public Facilities API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 *
 * For local development with SAM, the parent stack will instantiate PublicFacilitiesConstruct
 * directly instead of using this NestedStack (SAM doesn't support nested stacks).
 */
class PublicFacilitiesNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubFAC`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.publicFacilitiesConstruct = new PublicFacilitiesConstruct(this, 'PublicFacilities', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });
  }
}

module.exports = { PublicFacilitiesNestedStack };
