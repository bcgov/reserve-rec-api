const lambda = require('aws-cdk-lib/aws-lambda');
const apigatewayv2Integrations = require('aws-cdk-lib/aws-apigatewayv2-integrations');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function webSocketSetup(scope, props) {
  console.log('WebSocket handlers setup...');


  const wsConnect = new NodejsFunction(scope, 'WSConnect', {
    code: lambda.Code.fromAsset('lib/handlers/webSockets'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  props.wsApi.addRoute('$default', {
    integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSDefaultIntegration", wsConnect),
    routeOptions: {
      enableTwoWayCommunication: true
    }
  });
  props.pubsubTable.grantReadWriteData(wsConnect);
  props.wsApi.addRoute('$connect', {
    integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSDefaultIntegration", wsConnect),
    routeOptions: {
      enableTwoWayCommunication: true
    }
  });
  props.pubsubTable.grantReadWriteData(wsConnect);
  props.wsApi.addRoute('$disconnect', {
    integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSDefaultIntegration", wsConnect),
    routeOptions: {
      enableTwoWayCommunication: true
    }
  });
  props.pubsubTable.grantReadWriteData(wsConnect);

  return {
    wsConnect: wsConnect
  };

}

module.exports = {
  webSocketSetup
};