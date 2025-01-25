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

        const wsDisconnect = new NodejsFunction(this.scope, 'WSDisconnect', {
            code: lambda.Code.fromAsset('lib/handlers/webSockets'),
            handler: 'index.handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            environment: this.props.env,
            layers: this.props.layers,
        });

        const wsSendMessage = new NodejsFunction(this.scope, 'WSSendMessage', {
            code: lambda.Code.fromAsset('lib/handlers/webSockets'),
            handler: 'index.handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            environment: this.props.env,
            layers: this.props.layers,
        });

        this.props.api.addRoute('$connect', {
            integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSConnectIntegration", wsConnect),
        });

        this.props.api.addRoute('$disconnect', {
            integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSDisconnectIntegration", wsDisconnect),
        });

        this.props.api.addRoute('sendMessage', {
            integration: new apigatewayv2Integrations.WebSocketLambdaIntegration("WSSendMessageIntegration", wsSendMessage),
        });
    }
}

module.exports = {
    WebSocketResources
};