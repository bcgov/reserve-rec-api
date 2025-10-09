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
const { activitiesSetup } = require('./handlers/activities/resources');
const { bookingsSetup } = require('./handlers/bookings/resources');
const { configSetup } = require('./handlers/config/resources');
const { facilitiesSetup } = require('./handlers/facilities/resources');
const { geozonesSetup } = require('./handlers/geozones/resources');
const { transactionsSetup } = require('./handlers/transactions/resources');
const { productsSetup } = require('./handlers/products/resources');
const { protectedAreasSetup } = require('./handlers/protectedAreas/resources');
const { searchSetup } = require('./handlers/search/resources');
const { streamSetup } = require('./handlers/dynamoStream/resources');
const { toolingSetup } = require('./handlers/tooling/resources');
const { userSetup } = require('./handlers/users/resources');
const { webSocketSetup } = require('./handlers/webSockets/resources');
const { worldlineNotificationSetup } = require('./handlers/worldlineNotification/resources');
const { bcscSetup } = require('./handlers/bcsc/resources');
const { emailDispatchSetup } = require('./handlers/emailDispatch/resources');

class ReserveRecCdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // If offline, merge env vars
    if (props.env.IS_OFFLINE === 'true') {
      console.log('Running offline...');
      props.env = { ...process.env, ...props.env };
      delete props.env.AWS_REGION;
      delete props.env.AWS_DEFAULT_REGION;
      delete props.env.AWS_SESSION_TOKEN;
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
      publicRequestAuthorizer: authorizerResources.publicRequestAuthorizer,
      adminRequestAuthorizer: authorizerResources.adminRequestAuthorizer,
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
      mainTable: dynamodbResources.mainTable,
    });

    // set the env var for OpenSearch endpoint
    if (props.env.IS_OFFLINE !== 'true') {
      props.env.OPENSEARCH_DOMAIN_URL = `https://${opensearchResources.opensearchDomain.domainEndpoint}`;
    }

    // S3
    const s3Resources = s3Setup(this, {
      env: props.env,
    });

    // EMAIL DISPATCH (SQS + SES)
    const emailDispatchResources = emailDispatchSetup(this, {
      env: props.env,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
      ],
    });

    // Set email queue URL environment variable for other lambdas
    props.env.EMAIL_QUEUE_URL = emailDispatchResources.emailQueue.queueUrl;



    // LAMBDA FUNCTION HANDLERS & RESOURCES

    // Activities
    const activitiesResources = activitiesSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable
    });

    // Bookings (requires activities)
    const bookingsResources = bookingsSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable,
      activitiesResources: activitiesResources,
      openSearchDomain: opensearchResources.opensearchDomain,
    });

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

    // Facilities
    const facilitiesResources = facilitiesSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable
    });

    // Geozone
    const geozonesResources = geozonesSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable
    });

    // Products
    const productsResources = productsSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable,
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
    //BCSC
    const bcscResources = bcscSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.jwtLayer,
      ],
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
      tablesCreatedByCDK: dynamodbResources.tablesCreatedByCDK,
    });

    // Tooling

    const toolingResources = toolingSetup(this, {
      env: props.env,
      opensearchDomainArn: opensearchResources.opensearchDomain.domainArn,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      osRole: opensearchResources.osMasterRole,
      mainTable: dynamodbResources.mainTable,
    });

    // Transactions
    const transactionsResources = transactionsSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      mainTable: dynamodbResources.mainTable
    });

    // Users
    const userResources = userSetup(this, {
      env: props.env,
      api: apigwResources.api,
      layers: [
        layerResources.baseLayer,
        layerResources.awsUtilsLayer,
        layerResources.dataUtilsLayer
      ],
      adminRequestAuthorizer: authorizerResources.adminRequestAuthorizer,
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

      // Worldline Notification Webhook
      const worldlineNotification = worldlineNotificationSetup(this, {
        env: props.env,
        api: apigwResources.api,
        layers: [
          layerResources.baseLayer,
          layerResources.awsUtilsLayer,
          layerResources.dataUtilsLayer
        ],
        mainTable: dynamodbResources.mainTable
      });
    }

  }
}

module.exports = {
  ReserveRecCdkStack,
};
