const lambda = require('aws-cdk-lib/aws-lambda');
const apigatewayv2Integrations = require('aws-cdk-lib/aws-apigatewayv2-integrations');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class WebSocketResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    const wsConnect = new NodejsFunction(this.scope, 'WSConnect', {
      code: lambda.Code.fromAsset('lib/handlers/webSockets'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
    });
    this.props.wsApi.addRoute('$default', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSDefaultIntegration", wsConnect),
    });
    this.props.pubsubTable.grantReadWriteData(wsConnect);
  }
}

module.exports = {
  WebSocketResources
};