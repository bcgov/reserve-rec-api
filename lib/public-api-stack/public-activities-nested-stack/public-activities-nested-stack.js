'use strict';

const { NestedStack } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { ActivitiesConstruct } = require('../../../src/handlers/activities/constructs');

/**
 * NestedStack for Public Activities API endpoints
 *
 * The API Gateway and Authorizer are passed by ID from the parent stack avoiding,
 * cross-stack CDK object references that were consuming root stack resources.
 */
class PublicActivitiesNestedStack extends NestedStack {
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
    this.concreteStackId = `${scope.stackId}-PubACT`;

    // Reconstruct the API reference from the imported IDs
    const importedApi = apigw.RestApi.fromRestApiAttributes(this, 'ImportedPublicApi', {
      restApiId: props.restApiId,
      rootResourceId: props.rootResourceId,
    });

    this.activitiesConstruct = new ActivitiesConstruct(this, 'Activities', {
      environment: props.environment,
      layers: props.layers,
      api: importedApi,
      authorizer: props.authorizer,
      handlerPrefix: props.handlerPrefix,
    });

    // Grant read access so the public GET handler can check waiting room status
    if (props.waitingRoomTable) {
      props.waitingRoomTable.grantReadData(this.activitiesConstruct.activitiesCollectionIdGetFunction);
    }
  }
}

module.exports = { PublicActivitiesNestedStack };
