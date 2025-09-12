/**
 * Builds a WebSocket API Gateway.
 */

const { CfnOutput } = require('aws-cdk-lib');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');

function webSocketApiSetup(scope, props) {
  console.log('Setting up WebSocket resources...');

  // WEB SOCKET API
  const webSocketApi = new apigatewayv2.WebSocketApi(scope, 'WebSocketApi');
  new apigatewayv2.WebSocketStage(scope, 'WebSocketStage', {
    webSocketApi,
    stageName: props.env.API_STAGE,
    autoDeploy: true,
  });

  // Outputs
  new CfnOutput(scope, 'WebSocketApiId', {
    value: webSocketApi.apiId,
    description: 'WebSocket API Id Reference',
    exportName: `WebSocketApiId-${props.env.environmentName}`,
  });

  new CfnOutput(scope, 'WebSocketApiEndpoint', {
    value: webSocketApi.apiEndpoint,
    description: 'WebSocket API Endpoint Reference',
    exportName: `WebSocketApiEndpoint-${props.env.environmentName}`,
  });

  return {
    webSocketApi: webSocketApi,
  };

}

module.exports = {
  webSocketApiSetup
};
