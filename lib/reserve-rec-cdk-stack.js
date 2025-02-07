const { Aws, Stack, RemovalPolicy, SecretValue } = require('aws-cdk-lib');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');
const lambda = require('aws-cdk-lib/aws-lambda');

// PROJECT RESOURCES
const { ConfigResources } = require('./handlers/config/resources');
const { ProtectedAreaResources } = require('./handlers/protectedAreas/resources');
const { StreamResources } = require('./handlers/dynamoStream/resources');
const { ToolingResources } = require('./handlers/tools/resources');
const { WebSocketResources } = require('./handlers/webSockets/resources');
const { apigwSetup } = require('./cdk/apigateway');
const { cognitoSetup } = require('./cdk/cognito');
const { dynamodbSetup } = require('./cdk/dynamodb');
const { layerSetup } = require('./cdk/lambda');
const { opensearchSetup } = require('./cdk/opensearch');

class ReserveRecCdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // If offline, merge env vars
    if (props.env.IS_OFFLINE === 'true') {
      console.log('Running offline...');
      props.env = { ...process.env, ...props.env };
    }

    // COGNITO
    cognitoSetup(this, Aws.ACCOUNT_ID);

    // API GATEWAY
    const apigwResources = apigwSetup(this, {
      env: props.env,
    });

    // WEB SOCKET API

    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi');
    new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: props.env.API_STAGE,
      autoDeploy: true,
    });
    props.env.WEBSOCKET_URL = webSocketApi.apiEndpoint.replace('wss', 'https');

    // DYNAMODB TABLES

    const dynamodbResources = dynamodbSetup(this, {
      env: props.env,
    });

    // OPENSEARCH

    const opensearchResources = opensearchSetup(this, {
      env: props.env,
      auditTable: dynamodbResources.auditTable,

    });

    // set the env var for OpenSearch endpoint
    if (props.env.IS_OFFLINE !== 'true') {
      props.env.OPENSEARCH_DOMAIN_URL = `https://${opensearchResources.opensearchDomain.domainEndpoint}`;
    }

    // LAMBDA LAYERS

    const layerResources = layerSetup(this, {
      env: props.env,
    });

    // LAMBDA FUNCTION RESOURCES (ALPHABETIZED)

    // Config
    const configResources = new ConfigResources(this, 'ConfigResources', {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
      mainTable: dynamodbResources.mainTable
    });

    // Protected Areas
    const protectedAreaResources = new ProtectedAreaResources(this, 'ProtectedAreaResources', {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable,
    });

    // Stream (DynamoDB)
    const streamResources = new StreamResources(this, 'StreamResources', {
      auditTable: dynamodbResources.auditTable,
      webSocketApiRef: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${webSocketApi.id}`,
      env: props.env,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
      mainTable: dynamodbResources.mainTable,
      pubsubTable: dynamodbResources.pubsubTable,
      role: opensearchResources.osMasterRole,
      streamPolicies: [
        opensearchResources.osMasterRoleDynamoDBPolicy,
        opensearchResources.osMasterRoleOSPolicy,
      ],
    });

    // Tooling

    const toolingResources = new ToolingResources(this, 'ToolingResources', {
      env: props.env,
      opensearchDomainArn: opensearchResources.opensearchDomain.domainArn,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
      osRole: opensearchResources.osMasterRole,
      mainTable: dynamodbResources.mainTable,
    });

    // WebSocket
    const webSocketResources = new WebSocketResources(this, 'WebSocketResources', {
      env: props.env,
      wsApi: webSocketApi,
      lambda: lambda,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
      pubsubTable: dynamodbResources.pubsubTable
    });

  }
}

module.exports = {
  ReserveRecCdkStack,
  lambda,
};
