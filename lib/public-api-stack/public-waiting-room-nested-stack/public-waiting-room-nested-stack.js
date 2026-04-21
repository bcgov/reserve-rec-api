'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { WaitingRoomPublicConstruct } = require('../../../src/handlers/waiting-room/constructs');

/**
 * NestedStack for Public Waiting Room API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 */
class PublicWaitingRoomNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-PubWR`;

    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.waitingRoomPublicConstruct = new WaitingRoomPublicConstruct(this, 'WaitingRoomPublic', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      waitingRoomTable: props.waitingRoomTable,
      hmacSigningKey: props.hmacSigningKey,
    });
  }
}

module.exports = { PublicWaitingRoomNestedStack };
