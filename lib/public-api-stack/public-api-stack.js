const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const wafv2 = require('aws-cdk-lib/aws-wafv2');
const ssm = require('aws-cdk-lib/aws-ssm');
const { logger } = require("../helpers/utils");
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { PublicAuthorizerConstruct } = require("../../src/handlers/authorizers/constructs");
const { PingApiConstruct } = require("../../src/handlers/ping/constructs");
const { PublicConfigLambdas } = require('../../src/handlers/config/constructs');
const { PublicSearchLambda } = require('../../src/handlers/search/constructs');
const { GeozonesConstruct } = require('../../src/handlers/geozones/constructs');
const { PublicFacilitiesConstruct } = require('../../src/handlers/facilities/constructs');
const { ActivitiesConstruct } = require('../../src/handlers/activities/constructs');
const { PublicProductsConstruct } = require('../../src/handlers/products/constructs');
const { PublicBookingsConstruct } = require('../../src/handlers/bookings/constructs');
const { TransactionsConstruct } = require('../../src/handlers/transactions/constructs');
const { WorldlineNotificationConstruct } = require('../../src/handlers/worldlineNotification/constructs');
const { PublicFeatureFlagsConstruct } = require('../../src/handlers/featureFlags/constructs');
const { PublicProductDatesConstruct } = require('../../src/handlers/productDates/constructs');
const { WaitingRoomPublicConstruct } = require('../../src/handlers/waiting-room/constructs');

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
    publicProductDatesConstruct: {
      name: 'PublicProductDatesConstruct',
    },
    publicConfigLambdas: {
      name: 'PublicConfigLambdas'
    },
    publicSearchLambda: {
      name: 'PublicSearchLambda',
    },
    geozonesConstruct: {
      name: 'GeozonesConstruct',
    },
    publicFacilitiesConstruct: {
      name: 'PublicFacilitiesConstruct',
    },
    activitiesConstruct: {
      name: 'ActivitiesConstruct',
    },
    publicProductsConstruct: {
      name: 'PublicProductsConstruct',
    },
    transactionsConstruct: {
      name: 'TransactionsConstruct',
    },
    worldlineNotificationConstruct: {
      name: 'WorldlineNotificationConstruct',
    },
    publicFeatureFlagsConstruct: {
      name: 'PublicFeatureFlagsConstruct',
    },
    waitingRoomPublicConstruct: {
      name: 'WaitingRoomPublicConstruct',
    },
    originVerifyWebAcl: {
      name: 'OriginVerifyWebAcl',
    },
    originVerifyWebAclAssociation: {
      name: 'OriginVerifyWebAclAssociation',
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
    qrSecretKey: {
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
    const smsReminderQueueUrl = scope.resolveSmsReminderQueueUrl(this);
    const smsReminderQueueArn = scope.resolveSmsReminderQueueArn(this);

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
      handlerPrefix: 'admin',
    });

    // Facilities Lambdas
    this.publicFacilitiesConstruct = new PublicFacilitiesConstruct(this, this.getConstructId('publicFacilitiesConstruct'), {
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
      handlerPrefix: 'public',
    });

    // Activities Lambdas
    this.activitiesConstruct = new ActivitiesConstruct(this, this.getConstructId('activitiesConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        WAITING_ROOM_TABLE_NAME: scope.resolveWaitingRoomTableName(),
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'public',
    });
    // Grant read access so the public GET handler can check waiting room status
    scope.getWaitingRoomTable().grantReadData(this.activitiesConstruct.activitiesCollectionIdGetFunction);

    // Products Lambdas
    this.publicProductsConstruct = new PublicProductsConstruct(this, this.getConstructId('publicProductsConstruct'), {
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
      handlerPrefix: 'public',
    });

    // Bookings Lambdas
    this.publicBookingsConstruct = new PublicBookingsConstruct(this, this.getConstructId('publicBookingsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        BOOKING_NOTIFICATION_TOPIC_ARN: bookingNotificationTopicArn,
        QR_SECRET_KEY: this.getSecretValue('qrSecretKey'),
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

    // Feature Flags Lambdas
    this.publicFeatureFlagsConstruct = new PublicFeatureFlagsConstruct(this, this.getConstructId('publicFeatureFlagsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
    });

    // ProductDates Lambdas
    this.publicProductDatesConstruct = new PublicProductDatesConstruct(this, this.getConstructId('publicProductDatesConstruct'), {
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
      handlerPrefix: 'public',
    });

    // Waiting Room API Lambdas — join + claim + heartbeat endpoints
    this.waitingRoomPublicConstruct = new WaitingRoomPublicConstruct(this, this.getConstructId('waitingRoomPublicConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        WAITING_ROOM_TABLE_NAME: scope.resolveWaitingRoomTableName(),
        HMAC_SIGNING_KEY_ARN: scope.resolveHmacSigningKeyArn(),
        ADMISSION_TTL_MINUTES: '15',
        MAX_ADMISSION_MINUTES: '30',
        MAX_ENTRIES_PER_IP: '4',
        MIN_ACCOUNT_AGE_HOURS: '0',
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.publicApi,
      authorizer: requestAuthorizer,
      waitingRoomTable: scope.getWaitingRoomTable(),
      hmacSigningKey: scope.getHmacSigningKey(),
    });

    // Add WAITING_ROOM_TABLE_NAME + HMAC_SIGNING_KEY_ARN to the booking POST Lambda
    // so it can enforce admission token requirements when a waiting room is active.
    this.publicBookingsConstruct.bookingsPostFunction.addEnvironment(
      'WAITING_ROOM_TABLE_NAME', scope.resolveWaitingRoomTableName()
    );
    this.publicBookingsConstruct.bookingsPostFunction.addEnvironment(
      'HMAC_SIGNING_KEY_ARN', scope.resolveHmacSigningKeyArn()
    );
    this.publicBookingsConstruct.bookingsPostFunction.addEnvironment(
      'SMS_REMINDER_QUEUE_URL', smsReminderQueueUrl
    );
    // Grant DynamoDB read access on WR table and Secrets Manager read access for HMAC key
    scope.getWaitingRoomTable().grantReadData(this.publicBookingsConstruct.bookingsPostFunction);
    scope.getHmacSigningKey().grantRead(this.publicBookingsConstruct.bookingsPostFunction);
    this.publicBookingsConstruct.bookingsPostFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
      resources: [smsReminderQueueArn],
    }));

    // WAF: enforce X-Origin-Verify header so only CloudFront can reach the API Gateway stage
    // Path uses reserveRecApi (camelCase) matching sandbox-setup.sh APP_NAME convention
    const originVerifySecretPath = `/reserveRecApi/${this.getDeploymentName()}/originVerifySecret`;
    const originVerifySecret = ssm.StringParameter.valueFromLookup(this, originVerifySecretPath);

    const originVerifyWebAcl = new wafv2.CfnWebACL(this, this.getConstructId('originVerifyWebAcl'), {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${this.getConstructId('originVerifyWebAcl')}Metrics`,
        sampledRequestsEnabled: true,
      },
      rules: [{
        name: 'RequireOriginVerifyHeader',
        priority: 0,
        statement: {
          notStatement: {
            statement: {
              byteMatchStatement: {
                fieldToMatch: { singleHeader: { name: 'x-origin-verify' } },
                positionalConstraint: 'EXACTLY',
                searchString: originVerifySecret,
                textTransformations: [{ priority: 0, type: 'NONE' }],
              },
            },
          },
        },
        action: { block: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'RequireOriginVerifyHeaderMetric',
          sampledRequestsEnabled: true,
        },
      }],
    });

    new wafv2.CfnWebACLAssociation(this, this.getConstructId('originVerifyWebAclAssociation'), {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${this.publicApi.restApiId}/stages/${this.publicApi.deploymentStage.stageName}`,
      webAclArn: originVerifyWebAcl.attrArn,
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
