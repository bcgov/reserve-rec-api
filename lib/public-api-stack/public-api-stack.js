const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const { logger } = require("../helpers/utils");
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { PublicAuthorizerConstruct } = require("../../src/handlers/authorizers/constructs");
const { PingApiConstruct } = require("../../src/handlers/ping/constructs");
const { PublicConfigLambdas } = require('../../src/handlers/config/constructs');
const { PublicSearchLambda } = require('../../src/handlers/search/constructs');
const { ProtectedAreasConstruct } = require('../../src/handlers/protectedAreas/constructs');
const { GeozonesConstruct } = require('../../src/handlers/geozones/constructs');
const { FacilitiesConstruct } = require('../../src/handlers/facilities/constructs');
const { ActivitiesConstruct } = require('../../src/handlers/activities/constructs');
const { PublicBookingsConstruct } = require('../../src/handlers/bookings/constructs');
const { TransactionsConstruct } = require('../../src/handlers/transactions/constructs');
const { WorldlineNotificationConstruct } = require('../../src/handlers/worldlineNotification/constructs');

const defaults = {
  description: 'Public API stack providing a public API Gateway, authorization, and Lambda functions for the Reserve Recreation APIs.',
  constructs: {
    publicAuthorizer: {
      name: 'PublicAuthorizer',
    },
    publicApi: {
      name: 'PublicApi',
    },
    publicPingApi: {
      name: 'PublicPingApi',
    },
    publicApiLoggingRole: {
      name: 'PublicApiLoggingRole'
    },
    publicApiLoggingAccount: {
      name: 'PublicApiLoggingAccount'
    },
    publicBookingsConstruct: {
      name: 'PublicBookingsConstruct',
    },
    publicConfigLambdas: {
      name: 'PublicConfigLambdas'
    },
    publicSearchLambda: {
      name: 'PublicSearchLambda',
    },
    protectedAreasConstruct: {
      name: 'ProtectedAreasConstruct',
    },
    geozonesConstruct: {
      name: 'GeozonesConstruct',
    },
    facilitiesConstruct: {
      name: 'FacilitiesConstruct',
    },
    activitiesConstruct: {
      name: 'ActivitiesConstruct',
    },
    transactionsConstruct: {
      name: 'TransactionsConstruct',
    },
    worldlineNotificationConstruct: {
      name: 'WorldlineNotificationConstruct',
    },
  },
  config: {
    corsPreflightAllowHeaders: [
      "Content-Type",
      "X-Amz-Date",
      "Authorization",
      "X-Api-Key",
      "X-Amz-Security-Token"
    ],
    corsPreflightMaxAgeSeconds: 600,
    logLevel: process.env.LOG_LEVEL || 'info',
    publicUserPoolId: '',
    publicUserPoolClientId: '',
  },
  secrets: {
    merchantId: {
      name: "MerchantId",
    },
    hashKey: {
      name: "HashKey",
    },
    worldlineWebhookSecret: {
      name: "WorldlineWebhookSecret",
    },
    qrCodeSecret: {
      name: "qr-secret-key",
    },
  },
};

async function createPublicApiStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new PublicApiStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Public Api Stack: ${error}`);
  }
}

class PublicApiStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer);
    logger.info(`Creating Public API Stack: ${this.stackId}`);

    // Resolve Layers
    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);
    const opensearchDomainArn = scope.resolveOpenSearchDomainArn(this);
    const referenceDataTableName = scope.resolveRefDataTableName(this);
    const transactionalDataTableName = scope.resolveTransDataTableName(this);
    const refundRequestTopicArn = scope.resolveRefundRequestTopicArn(this);
    const bookingNotificationTopicArn = scope.resolveBookingNotificationTopicArn(this);
    const kmsKey = scope.resolveKmsKey(this);
    const emailQueueUrl = scope.resolveEmailQueueUrl(this);
    const emailQueueArn = scope.resolveEmailQueueArn(this);

    const publicFrontendDomain = scope.resolvePublicDomainName(this);

    // How the Authorizer determines User Pool settings:
    // If inheritPublicUserPoolSettingsFromDeployment is true, pull from the deployment stack
    // If false, use the values in config.publicUserPoolId and config.publicUserPoolClientId
    // If either of those are blank, look in DynamoDB for the deployment settings
    if (this.getConfigValue('inheritPublicUserPoolSettingsFromDeployment') === 'true') {
      // Pull in the user pool settings from the deployment stack
      this.setConfigValue('publicUserPoolId', scope.resolvePublicUserPoolId(this));
      this.setConfigValue('publicUserPoolClientId', scope.resolvePublicUserPoolClientId(this));
    }

    this.publicAuthorizerConstruct = new PublicAuthorizerConstruct(this, this.getConstructId('publicAuthorizer'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        OPENSEARCH_DOMAIN_ARN: opensearchDomainArn,
        PUBLIC_USER_POOL_ID: this.getConfigValue('publicUserPoolId') || null,
        PUBLIC_USER_POOL_CLIENT_ID: this.getConfigValue('publicUserPoolClientId') || null
      },
      layers: [baseLayer, awsUtilsLayer],
      description: `Public Authorizer for ${this.getAppName()}-${this.getDeploymentName()} environment`,
    });

    const requestAuthorizer = this.publicAuthorizerConstruct.getRequestAuthorizer();

    this.publicApi = new apigw.RestApi(this, this.getConstructId('publicApi'), {
      restApiName: this.getConstructId('publicApi'),
      description: `Public API for ${this.getAppName()}-${this.getDeploymentName()} environment`,
      deploy: true,
      defaultCorsPreflightOptions: {
        allowCredentials: true,
        allowHeaders: this.getConfigValue('corsPreflightAllowHeaders'),
        allowMethods: apigw.Cors.ALL_METHODS,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        maxAge: Duration.seconds(this.getConfigValue('corsPreflightMaxAgeSeconds') || 600),
      },
      deployOptions: {
        stageName: this.getConfigValue('publicApiStageName'),
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: false,
      }
    });

    // Attach the authorizer to the API Gateway
    requestAuthorizer._attachToApi(this.publicApi);

    // Create Ping API
    this.publicPingApiConstruct = new PingApiConstruct(this, this.getConstructId('publicPingApi'), {
      api: this.publicApi,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        API_NAME: this.publicApi.physicalName,
      },
      layers: [baseLayer, awsUtilsLayer],
    });

    // Public Config Getters
    this.publicConfigLambdas = new PublicConfigLambdas(this, this.getConstructId('publicConfigLambdas'), {
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      api: this.publicApi
    });

    // Public OpenSearch Search Function
    const searchEndpoint = `https://${scope.resolveOpenSearchDomainEndpoint(this)}`;
    this.publicSearchConstruct = new PublicSearchLambda(this, this.getConstructId('publicSearchLambda'), {
      opensearchDomainArn: opensearchDomainArn,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        OPENSEARCH_DOMAIN_ENDPOINT: searchEndpoint,
        OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.getConfigValue('opensearchReferenceDataIndexName'),
        OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: this.getConfigValue('opensearchTransactionalIndexName'),
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer
    });

    // Protected Areas Lambdas
    this.protectedAreasConstruct = new ProtectedAreasConstruct(this, this.getConstructId('protectedAreasConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      // TODO: This class currently uses the admin handler. Create a separate public handler if needed.
      handlerPrefix: 'admin',
    });

    // Geozone Lambdas
    this.geozonesConstruct = new GeozonesConstruct(this, this.getConstructId('geozonesConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      // TODO: This class currently uses the admin handler. Create a separate public handler if needed.
      handlerPrefix: 'admin',
    });

    // Facilities Lambdas
    this.facilitiesConstruct = new FacilitiesConstruct(this, this.getConstructId('facilitiesConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      // TODO: This class currently uses the admin handler. Create a separate public handler if needed.
      handlerPrefix: 'admin',
    });

    // Activities Lambdas
    this.activitiesConstruct = new ActivitiesConstruct(this, this.getConstructId('activitiesConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      // TODO: This class currently uses the admin handler. Create a separate public handler if needed.
      handlerPrefix: 'admin',
    });

    // Bookings Lambdas
    this.publicBookingsConstruct = new PublicBookingsConstruct(this, this.getConstructId('publicBookingsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        BOOKING_NOTIFICATION_TOPIC_ARN: bookingNotificationTopicArn,
        QR_SECRET_KEY: this.getSecretValue('qr-secret-key'),
        PUBLIC_FRONTEND_DOMAIN: publicFrontendDomain,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'public',
      kmsKey: kmsKey,
    });

    // Transactions Lambdas
    this.transactionsConstruct = new TransactionsConstruct(this, this.getConstructId('transactionsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        MERCHANT_ID: this.getSecretValue('merchantId'),
        HASH_KEY: this.getSecretValue('hashKey'),
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      refundRequestTopicArn: refundRequestTopicArn,
      kmsKey: kmsKey,
    });

    // Worldline Notification Lambdas
    this.worldlineNotificationConstruct = new WorldlineNotificationConstruct(this, this.getConstructId('worldlineNotificationConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        WORLDLINE_WEBHOOK_SECRET: this.getSecretValue('worldlineWebhookSecret'),
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      emailQueueUrl: emailQueueUrl,
      emailQueueArn: emailQueueArn,
      kmsKey: kmsKey,
    });

    // Export References

    // Public API ID
    this.exportReference(this, 'publicApiId', this.publicApi.restApiId, `ID of the Public API Gateway in ${this.stackId}`);

    // Public API URL
    this.exportReference(this, 'publicApiUrl', this.publicApi.url, `URL of the Public API Gateway in ${this.stackId}`);

    // Bind resolvers to app scope for other stacks to consume
    scope.resolvePublicApiId = this.resolvePublicApiId.bind(this);
    scope.resolvePublicApiUrl = this.resolvePublicApiUrl.bind(this);
  }

  // Resolve functions for resources
  resolvePublicApiId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicApiId'));
  }

  resolvePublicApiUrl(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicApiUrl'));
  }

}

// Create Public Authorizer for the API Gateway


module.exports = {
  createPublicApiStack,
};
