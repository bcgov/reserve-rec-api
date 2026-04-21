'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { AdminWaitingRoomConstruct } = require('../../../src/handlers/waiting-room/admin/constructs');

/**
 * NestedStack for Admin Waiting Room API endpoints
 *
 * The API Gateway and Authorizer are now passed by ID from the parent stack,
 * avoiding cross-stack CDK object references that were consuming root stack resources.
 */
class AdminWaitingRoomNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    // Propagate scope helpers from parent stack so LambdaConstructs work inside NestedStack
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;
    this.concreteStackId = `${scope.stackId}-AdmWR`;

    // Reconstruct the API reference from the imported IDs (scoped to this nested stack)
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedAdminApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.adminWaitingRoomConstruct = new AdminWaitingRoomConstruct(this, 'AdminWaitingRoom', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      waitingRoomTableName: props.waitingRoomTableName,
      waitingRoomTableArn: props.waitingRoomTableArn,
      viewerFunctionName: props.viewerFunctionName,
      releaseLambdaArn: props.releaseLambdaArn,
      wsManagementEndpoint: props.wsManagementEndpoint,
    });
  }
}

module.exports = {
  AdminWaitingRoomNestedStack,
};
