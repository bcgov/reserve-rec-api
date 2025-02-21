const { Aws, Stack } = require('aws-cdk-lib');

// PROJECT RESOURCES

// CDK RESOURCES
const { apigwSetup } = require('./cdk/apigateway');
const { cognitoAdminSetup } = require('./cdk/cognito-admin');
const { cognitoPublicSetup } = require('./cdk/cognito-public');
const { dynamodbSetup } = require('./cdk/dynamodb');
const { layerSetup } = require('./cdk/lambda');
const { opensearchSetup } = require('./cdk/opensearch');
const { s3Setup } = require('./cdk/s3');
const { webSocketApiSetup } = require('./cdk/websockets');

// HANDLER RESOURCES
const { authorizerSetup } = require('./handlers/authorizer/resources');
const { configSetup } = require('./handlers/config/resources');
const { protectedAreasSetup } = require('./handlers/protectedAreas/resources');
const { searchSetup } = require('./handlers/search/resources');
const { streamSetup } = require('./handlers/dynamoStream/resources');
const { toolingSetup } = require('./handlers/tooling/resources');
const { webSocketSetup } = require('./handlers/webSockets/resources');


class ReserveRecCdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // If offline, merge env vars
    if (props.env.IS_OFFLINE === 'true') {
      console.log('Running offline...');
      props.env = { ...process.env, ...props.env };
      delete props.env.AWS_REGION;
      delete props.env.AWS_ACCESS_KEY_ID;
      delete props.env.AWS_SECRET_ACCESS_KEY;
    }

    // COGNITO
    cognitoAdminSetup(this, props);
    cognitoPublicSetup(this, props);

    // LAMBDA LAYERS

    const layerResources = layerSetup(this, {
      env: props.env,
    });

    // AUTHORIZER LAMBDA
    const authorizerResources = authorizerSetup(this, {
      env: props.env,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer
      ]
    });

    // API GATEWAY
    const apigwResources = apigwSetup(this, {
      env: props.env,
      authFunction: authorizerResources.authFunction,
    });

    // WEB SOCKET API
    const webSocketApiResources = webSocketApiSetup(this, {
      env: props.env,
    });

    props.env.WEBSOCKET_URL = webSocketApiResources.webSocketApi.apiEndpoint.replace('wss', 'https');

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

    // S3
    const s3Resources = s3Setup(this, {
      env: props.env,
    });



    // LAMBDA FUNCTION HANDLERS & RESOURCES (ALPHABETIZED)

    // Config
    const configResources = configSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
      mainTable: dynamodbResources.mainTable
    });

    // Protected Areas
    const protectedAreaResources = protectedAreasSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable,
    });

    // Search (OpenSearch)
    const searchResources = searchSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
      openSearchDomain: opensearchResources.opensearchDomain,
    });

    // Stream (DynamoDB)
    const streamResources = streamSetup(this, {
      auditTable: dynamodbResources.auditTable,
      webSocketApiRef: `arn:aws:execute-api:${Aws.REGION}:${Aws.ACCOUNT_ID}:${webSocketApiResources.webSocketApi.id}`,
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

    const toolingResources = toolingSetup(this, {
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
    // Note: We have not yet developed support for WebSockets in offline (sam local start-api) mode
    // Running the WebSocket API in offline mode will cause the stack to fail to deploy
    if (props.env.IS_OFFLINE !== 'true') {
      const webSocketResources = webSocketSetup(this, {
        env: props.env,
        wsApi: webSocketApiResources.webSocketApi,
        layers: [
          layerResources.baseLayer,
          layerResources.awsUtilsLayer,
        ],
        pubsubTable: dynamodbResources.pubsubTable
      });
    }

  }
}

module.exports = {
  ReserveRecCdkStack,
};
