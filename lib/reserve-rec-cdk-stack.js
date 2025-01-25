
const { Stack } = require('aws-cdk-lib');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');

// PROJECT RESOURCES
const { ProtectedAreaResources } = require('./handlers/protectedAreas/resources');
const { WebSocketResources } = require('./handlers/webSockets/resources');

class ReserveRecCdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // API GATEWAY

    const api = new apigateway.RestApi(this, 'ApiDeployment', {
      restApiName: 'ReserveRecApi',
      description: 'Reserve Rec API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // WEB SOCKET API

    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi');
    new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'dev',
      autoDeploy: true,
    });

    // DYNAMODB TABLES

    // Main Reserve Rec Data Table
    const mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: props.env.TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Audit Table
    const auditTable = new dynamodb.Table(this, 'AuditTable', {
      tableName: props.env.AUDIT_TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // PubSub Table
    const pubsubTable = new dynamodb.Table(this, 'PubSubTable', {
      tableName: props.env.PUBSUB_TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // LAMBDA LAYERS

    const baseLayer = new lambda.LayerVersion(this, 'BaseLambdaLayer', {
      code: lambda.Code.fromAsset('lib/layers/base'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Base Utils Lambda Layer',
      layerName: 'BaseUtilsLayer',
      licenseInfo: 'Apache-2.0',
    });

    const awsUtilsLayer = new lambda.LayerVersion(this, 'AwsUtilsLambdaLayer', {
      code: lambda.Code.fromAsset('lib/layers/awsUtils'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'AWS Utils Lambda Layer',
      layerName: 'AwsUtilsLayer',
      licenseInfo: 'Apache-2.0',
    });

    const dataUtilsLayer = new lambda.LayerVersion(this, 'DataUtilsLambdaLayer', {
      code: lambda.Code.fromAsset('lib/layers/dataUtils'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Data Utils Lambda Layer',
      layerName: 'DataUtilsLayer',
      licenseInfo: 'Apache-2.0',
    });

    const protectedAreaResources = new ProtectedAreaResources(this, 'ProtectedAreaResources', {
      env: props.env,
      api: api,
      lambda: lambda,
      layers: [
        baseLayer,
        awsUtilsLayer,
        dataUtilsLayer
      ]
    });

    const webSocketResources = new WebSocketResources(this, 'WebSocketResources', {
      env: props.env,
      api: webSocketApi,
      lambda: lambda,
      layers: [
        baseLayer,
        awsUtilsLayer,
      ]
    });
  }
}

module.exports = {
  ReserveRecCdkStack,
  lambda,
};
