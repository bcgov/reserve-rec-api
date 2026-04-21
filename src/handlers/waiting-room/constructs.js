'use strict';

const { LambdaConstruct } = require('../../../lib/helpers/base-lambda');
const apigw = require('aws-cdk-lib/aws-apigateway');

const defaults = {
  resources: {
    joinFunction: {
      name: 'WaitRoomJoin',
    },
    claimFunction: {
      name: 'WaitRoomClaim',
    },
    heartbeatFunction: {
      name: 'WaitRoomHeartbeat',
    },
    mode2StatusFunction: {
      name: 'WaitRoomMode2Status',
    },
  },
};

/**
 * CDK construct for the waiting room public API endpoints:
 *   POST /waiting-room/join
 *   POST /waiting-room/claim
 *
 * Requires props:
 *   - api: RestApi
 *   - authorizer: RequestAuthorizer
 *   - environment: { WAITING_ROOM_TABLE_NAME, HMAC_SIGNING_KEY_ARN, ... }
 *   - layers: Lambda layer array
 *   - waitingRoomTable: DynamoDB Table construct (for IAM grants)
 *   - hmacSigningKey: Secrets Manager Secret construct (for IAM grants)
 */
class WaitingRoomPublicConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults,
    });

    // /waiting-room resource
    this.waitingRoomResource = this.resolveApi().root.addResource('waiting-room');

    // POST /waiting-room/join
    this.joinFunction = this.generateBasicLambdaFn(
      scope,
      'joinFunction',
      'src/handlers/waiting-room/join',
      'handler',
      { memorySize: 256, timeout: require('aws-cdk-lib').Duration.seconds(15) }
    );

    this.waitingRoomResource.addResource('join').addMethod(
      'POST',
      new apigw.LambdaIntegration(this.joinFunction),
      {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.resolveAuthorizer(),
      }
    );

    // POST /waiting-room/claim
    this.claimFunction = this.generateBasicLambdaFn(
      scope,
      'claimFunction',
      'src/handlers/waiting-room/claim',
      'handler',
      { memorySize: 256, timeout: require('aws-cdk-lib').Duration.seconds(15) }
    );

    this.waitingRoomResource.addResource('claim').addMethod(
      'POST',
      new apigw.LambdaIntegration(this.claimFunction),
      {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.resolveAuthorizer(),
      }
    );

    // POST /waiting-room/heartbeat
    this.heartbeatFunction = this.generateBasicLambdaFn(
      scope,
      'heartbeatFunction',
      'src/handlers/waiting-room/heartbeat',
      'handler',
      { memorySize: 256, timeout: require('aws-cdk-lib').Duration.seconds(15) }
    );

    this.waitingRoomResource.addResource('heartbeat').addMethod(
      'POST',
      new apigw.LambdaIntegration(this.heartbeatFunction),
      {
        authorizationType: apigw.AuthorizationType.CUSTOM,
        authorizer: this.resolveAuthorizer(),
      }
    );

    // GET /waiting-room/mode2/status (public, no auth)
    this.mode2StatusFunction = this.generateBasicLambdaFn(
      scope,
      'mode2StatusFunction',
      'src/handlers/waiting-room/GET',
      'mode2-status',
      { memorySize: 128, timeout: require('aws-cdk-lib').Duration.seconds(10) }
    );

    const mode2Resource = this.waitingRoomResource.addResource('mode2');
    mode2Resource.addResource('status').addMethod(
      'GET',
      new apigw.LambdaIntegration(this.mode2StatusFunction),
      { authorizationType: apigw.AuthorizationType.NONE }
    );

    // Grant DynamoDB read/write permissions to all API Lambdas
    if (props.waitingRoomTable) {
      props.waitingRoomTable.grantReadWriteData(this.joinFunction);
      props.waitingRoomTable.grantReadWriteData(this.claimFunction);
      props.waitingRoomTable.grantReadWriteData(this.heartbeatFunction);
      props.waitingRoomTable.grantReadData(this.mode2StatusFunction);
    }

    // Grant Secrets Manager read permissions for the HMAC key
    if (props.hmacSigningKey) {
      props.hmacSigningKey.grantRead(this.claimFunction);
      props.hmacSigningKey.grantRead(this.heartbeatFunction);
    }
  }
}

module.exports = { WaitingRoomPublicConstruct };
