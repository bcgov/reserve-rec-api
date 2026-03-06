'use strict';

const { NestedStack } = require('aws-cdk-lib');
const { AdminWaitingRoomConstruct } = require('../../../src/handlers/waiting-room/admin/constructs');

/**
 * NestedStack for Admin Waiting Room API endpoints
 *
 * This wrapper allows the AdminWaitingRoom functionality to be deployed as a nested stack
 * to work around CloudFormation's 500 resource limit per stack.
 */
class WaitingRoomAdminNestedStack extends NestedStack {
  get stackId() {
    return this._parentStackId || super.stackId;
  }

  constructor(scope, id, props) {
    super(scope, id, props);
    // Propagate scope helpers from parent stack so LambdaConstructs work inside NestedStack
    this.createScopedId = scope.createScopedId;
    this.appScope = scope.appScope;
    this._parentStackId = scope._stackId;

    this.adminWaitingRoomConstruct = new AdminWaitingRoomConstruct(this, 'AdminWaitingRoom', {
      environment: props.environment,
      layers: props.layers,
      api: props.api,
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
  WaitingRoomAdminNestedStack,
};
