/**
 * Builds a WebSocket API Gateway.
 */

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

  return {
    webSocketApi: webSocketApi,
  };

}

module.exports = {
  webSocketApiSetup
};
