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
        this.props.pubsubTable.grantReadWriteData(wsConnect);

        const wsDisconnect = new NodejsFunction(this.scope, 'WSDisconnect', {
            code: lambda.Code.fromAsset('lib/handlers/webSockets'),
            handler: 'index.handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            environment: this.props.env,
            layers: this.props.layers,
        });
        this.props.pubsubTable.grantReadWriteData(wsDisconnect);

        const wsSendMessage = new NodejsFunction(this.scope, 'WSSendMessage', {
            code: lambda.Code.fromAsset('lib/handlers/webSockets'),
            handler: 'index.handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            environment: this.props.env,
            layers: this.props.layers,
        });
        this.props.pubsubTable.grantReadWriteData(wsSendMessage);

        this.props.wsApi.addRoute('$connect', {
            integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSConnectIntegration", wsConnect),
        });

        this.props.wsApi.addRoute('$disconnect', {
            integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSDisconnectIntegration", wsDisconnect),
        });

        this.props.wsApi.addRoute('sendMessage', {
          integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSSendMessageIntegration", wsSendMessage),
          routeResponseSelectionExpression: '$default'
        });
    }
}

module.exports = {
    WebSocketResources
};