const apigw           = require('aws-cdk-lib/aws-apigateway');
const iam             = require('aws-cdk-lib/aws-iam');
const wafv2           = require('aws-cdk-lib/aws-wafv2');
const ssm             = require('aws-cdk-lib/aws-ssm');
const { logger }      = require("../helpers/utils");
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack }   = require('../helpers/base-stack');

// Flat constructs used only for local/SAM development
const { PublicBookingsConstruct }                = require('../../src/handlers/bookings/constructs');
const { PublicFacilitiesConstruct }              = require('../../src/handlers/facilities/constructs');
const { PublicProductsConstruct }                = require('../../src/handlers/products/constructs');
const { ActivitiesConstruct }                    = require('../../src/handlers/activities/constructs');
const { GeozonesConstruct }                      = require('../../src/handlers/geozones/constructs');
const { PublicProductDatesConstruct }            = require('../../src/handlers/productDates/constructs');
const { TransactionsConstruct }                  = require('../../src/handlers/transactions/constructs');

// Nested stacks for each major domain area
const { PublicApiCoreNestedStack }               = require('./public-api-core-nested-stack/public-api-core-nested-stack');
const { PublicActivitiesNestedStack }            = require('./public-activities-nested-stack/public-activities-nested-stack');
const { PublicBookingsNestedStack }              = require('./public-bookings-nested-stack/public-bookings-nested-stack');
const { PublicConfigNestedStack }                = require('./public-config-nested-stack/public-config-nested-stack');
const { PublicFacilitiesNestedStack }            = require('./public-facilities-nested-stack/public-facilities-nested-stack');
const { PublicFeatureFlagsNestedStack }          = require('./public-feature-flags-nested-stack/public-feature-flags-nested-stack');
const { PublicGeozonesNestedStack }              = require('./public-geozones-nested-stack/public-geozones-nested-stack');
const { PublicPingNestedStack }                  = require('./public-ping-nested-stack/public-ping-nested-stack');
const { PublicProductDatesNestedStack }          = require('./public-product-dates-nested-stack/public-product-dates-nested-stack');
const { PublicProductsNestedStack }              = require('./public-products-nested-stack/public-products-nested-stack');
const { PublicSearchNestedStack }                = require('./public-search-nested-stack/public-search-nested-stack');
const { PublicTransactionsNestedStack }          = require('./public-transactions-nested-stack/public-transactions-nested-stack');
const { PublicWaitingRoomNestedStack }           = require('./public-waiting-room-nested-stack/public-waiting-room-nested-stack');
const { PublicWorldlineNotificationNestedStack } = require('./public-worldline-notification-nested-stack/public-worldline-notification-nested-stack');

const defaults = {
  description: 'Public API stack providing a public API Gateway, authorization, and Lambda functions for the Reserve Recreation APIs.',
  constructs: {
    publicProductsConstruct:          { name: "PublicProductsConstruct" },
    publicBookingsConstruct:          { name: "PublicBookingsConstruct" },
    publicFacilitiesConstruct:        { name: "PublicFacilitiesConstruct" },
    publicProductDatesConstruct:      { name: "PublicProductDatesConstruct" },
    activitiesConstruct:              { name: "ActivitiesConstruct" },
    geozonesConstruct:                { name: "GeozonesConstruct" },
    transactionsConstruct:            { name: "TransactionsConstruct" },

    publicActivitiesNestedStack:      { name: "PublicActivitiesNestedStack" },
    publicApiCoreNestedStack:         { name: "PublicApiCoreNestedStack" },
    publicConfigNestedStack:          { name: "PublicConfigNestedStack" },
    publicFeatureFlagsNestedStack:    { name: "PublicFeatureFlagsNestedStack" },
    publicPingNestedStack:            { name: "PublicPingNestedStack" },
    publicSearchNestedStack:          { name: "PublicSearchNestedStack" },
    bookingsNestedStack:              { name: "PublicBookingsNestedStack" },
    facilitiesNestedStack:            { name: "PublicFacilitiesNestedStack" },
    geozonesNestedStack:              { name: "PublicGeozonesNestedStack" },
    originVerifyWebAcl:               { name: "OriginVerifyWebAcl" },
    originVerifyWebAclAssociation:    { name: "OriginVerifyWebAclAssociation" },
    productDatesNestedStack:          { name: "PublicProductDatesNestedStack" },
    productsNestedStack:              { name: "PublicProductsNestedStack" },
    transactionsNestedStack:          { name: "PublicTransactionsNestedStack" },
    waitingRoomNestedStack:           { name: "PublicWaitingRoomNestedStack" },
    worldlineNotificationNestedStack: { name: "PublicWorldlineNotificationNestedStack" },
  },
  config: {
    corsPreflightAllowHeaders: [
      "Content-Type",
      "X-Amz-Date",
      "Authorization",
      "X-Api-Key",
      "X-Amz-Security-Token",
    ],
    corsPreflightMaxAgeSeconds: 600,
    logLevel: process.env.LOG_LEVEL || 'info',
    publicApiStageName: 'api',
    inheritPublicUserPoolSettingsFromDeployment: 'true',
    publicUserPoolId: '',
    publicUserPoolClientId: '',
    opensearchReferenceDataIndexName: '',
    opensearchTransactionalIndexName: '',

    // Feature flags for selective deployment. These will allow you
    // to deploy the public API with only certain endpoints enabled, which can
    // be useful for sandbox environments or gradual rollout of new features
    enablePing: process.env.ENABLE_PING !== 'false',
    enableConfig: process.env.ENABLE_CONFIG !== 'false',
    enableSearch: process.env.ENABLE_SEARCH !== 'false',
    enableGeozones: process.env.ENABLE_GEOZONES !== 'false',
    enableFacilities: process.env.ENABLE_FACILITIES !== 'false',
    enableActivities: process.env.ENABLE_ACTIVITIES !== 'false',
    enableProducts: process.env.ENABLE_PRODUCTS !== 'false',
    enableBookings: process.env.ENABLE_BOOKINGS !== 'false',
    enableTransactions: process.env.ENABLE_TRANSACTIONS !== 'false',
    enableWorldlineNotification: process.env.ENABLE_WORLDLINE_NOTIFICATION !== 'false',
    enableFeatureFlags: process.env.ENABLE_FEATURE_FLAGS !== 'false',
    enableProductDates: process.env.ENABLE_PRODUCT_DATES !== 'false',
    enableWaitingRoom: process.env.ENABLE_WAITING_ROOM !== 'false',
  },
  secrets: {
    merchantId: { name: "MerchantId", },
    hashKey: { name: "HashKey", },
    worldlineWebhookSecret: { name: "WorldlineWebhookSecret", },
    qrSecretKey: { name: "qr-secret-key", },
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

    // SAM local development vs AWS deployment flag
    const isLocal = this.node.tryGetContext('@context') === 'local';

    // Resolve shared resources
    const baseLayer                   = scope.resolveBaseLayer(this);
    const awsUtilsLayer               = scope.resolveAwsUtilsLayer(this);
    const opensearchDomainArn         = scope.resolveOpenSearchDomainArn(this);
    const openSearchDomainEndpoint    = scope.resolveOpenSearchDomainEndpoint(this);
    const referenceDataTableName      = scope.resolveRefDataTableName(this);
    const transactionalDataTableName  = scope.resolveTransDataTableName(this);
    const refundRequestTopicArn       = scope.resolveRefundRequestTopicArn(this);
    const bookingNotificationTopicArn = scope.resolveBookingNotificationTopicArn(this);
    const kmsKey                      = scope.resolveKmsKey(this);
    const emailQueueUrl               = scope.resolveEmailQueueUrl(this);
    const emailQueueArn               = scope.resolveEmailQueueArn(this);
    const smsReminderQueueUrl         = scope.resolveSmsReminderQueueUrl(this);
    const smsReminderQueueArn         = scope.resolveSmsReminderQueueArn(this);
    const publicFrontendDomain        = scope.resolvePublicDomainName(this);

    // How the Authorizer determines User Pool settings:
    // If inheritPublicUserPoolSettingsFromDeployment is true, pull from the deployment stack
    // If false, use the values in config.publicUserPoolId and config.publicUserPoolClientId
    if (
      this.getConfigValue('inheritPublicUserPoolSettingsFromDeployment') === 'true'
    ) {
      this.setConfigValue('publicUserPoolId', scope.resolvePublicUserPoolId(this));
      this.setConfigValue('publicUserPoolClientId', scope.resolvePublicUserPoolClientId(this));
    }

    // Create the core API nested stack
    this.publicApiCoreNestedStack = new PublicApiCoreNestedStack(
      this,
      this.getConstructId('publicApiCoreNestedStack'),
      {
        corsPreflightAllowHeaders: this.getConfigValue('corsPreflightAllowHeaders'),
        corsPreflightMaxAgeSeconds: this.getConfigValue('corsPreflightMaxAgeSeconds'),
        publicApiStageName: this.getConfigValue('publicApiStageName'),
        logLevel: this.getConfigValue('logLevel'),
        publicUserPoolId: this.getConfigValue('publicUserPoolId'),
        publicUserPoolClientId: this.getConfigValue('publicUserPoolClientId'),
        opensearchDomainArn: opensearchDomainArn,
        baseLayer: baseLayer,
        awsUtilsLayer: awsUtilsLayer,
        appName: this.getAppName(),
        deploymentName: this.getDeploymentName(),
      },
    );

    // Get API identifiers from the core nested stack.
    // These are used to import the API into the other nested stacks without
    // creating CDK object references that consume root stack resources.
    const publicApiId = this.publicApiCoreNestedStack.getRestApiId();
    const publicApiRootResourceId = this.publicApiCoreNestedStack.getRootResourceId();

    // Ping API
    if (this.getConfigValue('enablePing')) {
      this.publicPingNestedStack = new PublicPingNestedStack(
        this,
        this.getConstructId('publicPingNestedStack'),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue('logLevel'),
            API_NAME: this.publicApiCoreNestedStack.publicApi.physicalName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: publicApiId,
          rootResourceId: publicApiRootResourceId,
        },
      );
    }

    // Public Config Getters
    if (this.getConfigValue('enableConfig')) {
      this.publicConfigNestedStack = new PublicConfigNestedStack(
        this,
        this.getConstructId('publicConfigNestedStack'),
        {
          layers: [baseLayer, awsUtilsLayer],
          restApiId: publicApiId,
          rootResourceId: publicApiRootResourceId,
        },
      );
    }

    // Public OpenSearch Search Function
    if (this.getConfigValue('enableSearch')) {
      const searchEndpoint = `https://${openSearchDomainEndpoint}`;
      this.publicSearchNestedStack = new PublicSearchNestedStack(
        this,
        this.getConstructId('publicSearchNestedStack'),
        {
          opensearchDomainArn: opensearchDomainArn,
          environment: {
            LOG_LEVEL: this.getConfigValue('logLevel'),
            OPENSEARCH_DOMAIN_ENDPOINT: searchEndpoint,
            OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.getConfigValue('opensearchReferenceDataIndexName'),
            OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: this.getConfigValue('opensearchTransactionalIndexName'),
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: publicApiId,
          rootResourceId: publicApiRootResourceId,
          authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        },
      );
    }

    // Geozone Lambdas
    if (this.getConfigValue('enableGeozones')) {
      const geozonesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        handlerPrefix: 'admin',
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.geozonesConstruct = new GeozonesConstruct(
          this,
          this.getConstructId('geozonesConstruct'),
          geozonesProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.geozonesNestedStack = new PublicGeozonesNestedStack(
          this,
          this.getConstructId('geozonesNestedStack'),
          geozonesProps,
        );
        this.geozonesConstruct = this.geozonesNestedStack.geozonesConstruct;
      }
    }

    // Facilities Lambdas
    if (this.getConfigValue('enableFacilities')) {
      const facilitiesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        handlerPrefix: 'public',
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.publicFacilitiesConstruct = new PublicFacilitiesConstruct(
          this,
          this.getConstructId('publicFacilitiesConstruct'),
          facilitiesProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.facilitiesNestedStack = new PublicFacilitiesNestedStack(
          this,
          this.getConstructId('facilitiesNestedStack'),
          facilitiesProps,
        );
        this.publicFacilitiesConstruct = this.facilitiesNestedStack.publicFacilitiesConstruct;
      }
    }

    // Activities Lambdas
    if (this.getConfigValue('enableActivities')) {
      const activitiesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          WAITING_ROOM_TABLE_NAME: scope.resolveWaitingRoomTableName(),
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        handlerPrefix: 'public',
        waitingRoomTable: scope.getWaitingRoomTable(),
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.activitiesConstruct = new ActivitiesConstruct(
          this,
          this.getConstructId('activitiesConstruct'),
          activitiesProps,
        );
        scope.getWaitingRoomTable().grantReadData(this.activitiesConstruct.activitiesCollectionIdGetFunction);
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.publicActivitiesNestedStack = new PublicActivitiesNestedStack(
          this,
          this.getConstructId('publicActivitiesNestedStack'),
          activitiesProps,
        );
        this.activitiesConstruct = this.publicActivitiesNestedStack.activitiesConstruct;
      }
    }

    // Products Lambdas
    if (this.getConfigValue('enableProducts')) {
      const productsProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        handlerPrefix: 'public',
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.publicProductsConstruct = new PublicProductsConstruct(
          this,
          this.getConstructId('publicProductsConstruct'),
          productsProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.productsNestedStack = new PublicProductsNestedStack(
          this,
          this.getConstructId('productsNestedStack'),
          productsProps,
        );
        this.publicProductsConstruct = this.productsNestedStack.publicProductsConstruct;
      }
    }

    // Bookings Lambdas
    if (this.getConfigValue('enableBookings')) {
      const bookingsProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
          BOOKING_NOTIFICATION_TOPIC_ARN: bookingNotificationTopicArn,
          QR_SECRET_KEY: this.getSecretValue('qrSecretKey'),
          PUBLIC_FRONTEND_DOMAIN: publicFrontendDomain,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        handlerPrefix: 'public',
        kmsKey: kmsKey,
        // Pass the activities resource ID so the bookings nested stack
        // can import it via fromResourceAttributes()
        activitiesActivityIdResourceId: isLocal ? null : this.activitiesConstruct?.activitiesActivityIdResource?.resourceId,
        waitingRoomTableName: scope.resolveWaitingRoomTableName(),
        hmacSigningKeyArn: scope.resolveHmacSigningKeyArn(),
        smsReminderQueueUrl: smsReminderQueueUrl,
        smsReminderQueueArn: smsReminderQueueArn,
        waitingRoomTable: scope.getWaitingRoomTable(),
        hmacSigningKey: scope.getHmacSigningKey(),
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.publicBookingsConstruct = new PublicBookingsConstruct(
          this,
          this.getConstructId('publicBookingsConstruct'),
          bookingsProps,
        );
        // Add waiting room and SMS reminder props to the booking POST Lambda
        this.publicBookingsConstruct.bookingsPostFunction.addEnvironment(
          'WAITING_ROOM_TABLE_NAME', scope.resolveWaitingRoomTableName()
        );
        this.publicBookingsConstruct.bookingsPostFunction.addEnvironment(
          'HMAC_SIGNING_KEY_ARN', scope.resolveHmacSigningKeyArn()
        );
        this.publicBookingsConstruct.bookingsPostFunction.addEnvironment(
          'SMS_REMINDER_QUEUE_URL', smsReminderQueueUrl
        );
        scope.getWaitingRoomTable().grantReadData(this.publicBookingsConstruct.bookingsPostFunction);
        scope.getHmacSigningKey().grantRead(this.publicBookingsConstruct.bookingsPostFunction);
        this.publicBookingsConstruct.bookingsPostFunction.addToRolePolicy(new iam.PolicyStatement({
          actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
          resources: [smsReminderQueueArn],
        }));
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.bookingsNestedStack = new PublicBookingsNestedStack(
          this,
          this.getConstructId('bookingsNestedStack'),
          bookingsProps,
        );
        this.publicBookingsConstruct = this.bookingsNestedStack.publicBookingsConstruct;
      }
    }

    // Transactions Lambdas
    if (this.getConfigValue('enableTransactions')) {
      const transactionsProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
          MERCHANT_ID: this.getSecretValue('merchantId'),
          HASH_KEY: this.getSecretValue('hashKey'),
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        refundRequestTopicArn: refundRequestTopicArn,
        kmsKey: kmsKey,
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.transactionsConstruct = new TransactionsConstruct(
          this,
          this.getConstructId('transactionsConstruct'),
          transactionsProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.transactionsNestedStack = new PublicTransactionsNestedStack(
          this,
          this.getConstructId('transactionsNestedStack'),
          transactionsProps,
        );
        this.transactionsConstruct = this.transactionsNestedStack.transactionsConstruct;
      }
    }

    // Worldline Notification Lambdas
    if (this.getConfigValue('enableWorldlineNotification')) {
      this.worldlineNotificationNestedStack = new PublicWorldlineNotificationNestedStack(
        this,
        this.getConstructId('worldlineNotificationNestedStack'),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue('logLevel'),
            TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
            WORLDLINE_WEBHOOK_SECRET: this.getSecretValue('worldlineWebhookSecret'),
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: publicApiId,
          rootResourceId: publicApiRootResourceId,
          authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
          emailQueueUrl: emailQueueUrl,
          emailQueueArn: emailQueueArn,
          kmsKey: kmsKey,
        },
      );
    }

    // Feature Flags Lambdas
    if (this.getConfigValue('enableFeatureFlags')) {
      this.publicFeatureFlagsNestedStack = new PublicFeatureFlagsNestedStack(
        this,
        this.getConstructId('publicFeatureFlagsNestedStack'),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue('logLevel'),
            REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: publicApiId,
          rootResourceId: publicApiRootResourceId,
        },
      );
    }

    // ProductDates Lambdas
    if (this.getConfigValue('enableProductDates')) {
      const productDatesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the object. For nested: pass the imported API.
        api: isLocal ? this.publicApiCoreNestedStack.publicApi : null,
        authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
        restApiId: publicApiId,
        rootResourceId: publicApiRootResourceId,
        handlerPrefix: 'public',
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.publicProductDatesConstruct = new PublicProductDatesConstruct(
          this,
          this.getConstructId('publicProductDatesConstruct'),
          productDatesProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.productDatesNestedStack = new PublicProductDatesNestedStack(
          this,
          this.getConstructId('productDatesNestedStack'),
          productDatesProps,
        );
        this.publicProductDatesConstruct = this.productDatesNestedStack.publicProductDatesConstruct;
      }
    }

    // Waiting Room API Lambdas — join + claim + heartbeat endpoints
    if (this.getConfigValue('enableWaitingRoom')) {
      this.waitingRoomNestedStack = new PublicWaitingRoomNestedStack(
        this,
        this.getConstructId('waitingRoomNestedStack'),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue('logLevel'),
            WAITING_ROOM_TABLE_NAME: scope.resolveWaitingRoomTableName(),
            HMAC_SIGNING_KEY_ARN: scope.resolveHmacSigningKeyArn(),
            ADMISSION_TTL_MINUTES: '15',
            MAX_ADMISSION_MINUTES: '30',
            MAX_ENTRIES_PER_IP: '4',
            MIN_ACCOUNT_AGE_HOURS: '0',
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: publicApiId,
          rootResourceId: publicApiRootResourceId,
          authorizer: this.publicApiCoreNestedStack.getAuthorizer(),
          waitingRoomTable: scope.getWaitingRoomTable(),
          hmacSigningKey: scope.getHmacSigningKey(),
        },
      );
    }

    // Ensure API redeployment when nested stacks are updated.
    // Since API Gateway Resources/Methods are now in nested stacks (not the root stack),
    // CDK doesn't automatically track their changes for redeployment.
    // We explicitly add dependencies so the deployment updates when spoke stacks change.
    const nestedStacks = [
      isLocal ? null : this.geozonesNestedStack,
      isLocal ? null : this.facilitiesNestedStack,
      isLocal ? null : this.publicActivitiesNestedStack,
      isLocal ? null : this.productsNestedStack,
      isLocal ? null : this.bookingsNestedStack,
      isLocal ? null : this.transactionsNestedStack,
      isLocal ? null : this.productDatesNestedStack,
      this.publicPingNestedStack,
      this.publicConfigNestedStack,
      this.publicSearchNestedStack,
      this.worldlineNotificationNestedStack,
      this.publicFeatureFlagsNestedStack,
      this.waitingRoomNestedStack,
    ].filter((stack) => stack !== null && stack !== undefined);

    // Create a unique deployment name using the current timestamp to force
    // redeployment when needed.
    const now = new Date().toISOString();

    const deployment = new apigw.Deployment(this, `Deployment-${now}`, {
      api: this.publicApiCoreNestedStack.publicApi,
    });

    // Add the dependencies to the deployment manually.
    // This tells CloudFormation to not run this deployment until all these
    // stacks are done and good to go.
    nestedStacks.forEach((nestedStack) => {
      if (nestedStack) {
        deployment.node.addDependency(nestedStack);
      }
    });

    // Create the Stage attached to that deployment
    const stage = new apigw.Stage(this, 'PublicApiStage', {
      deployment: deployment,
      stageName: this.getConfigValue('publicApiStageName'),
      loggingLevel: apigw.MethodLoggingLevel.INFO,
      dataTraceEnabled: true,
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
      publicRead: true,
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
      publicRead: true,
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
    // Grant DynamoDB read access on WR table and Secrets Manager read access for HMAC key
    scope.getWaitingRoomTable().grantReadData(this.publicBookingsConstruct.bookingsPostFunction);
    scope.getHmacSigningKey().grantRead(this.publicBookingsConstruct.bookingsPostFunction);

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
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${publicApiId}/stages/${stage.stageName}`,
      webAclArn: originVerifyWebAcl.attrArn,
    });

    // Export References

    // Public API ID
    this.exportReference(this, 'publicApiId', this.publicApiCoreNestedStack.getRestApiId(), `ID of the Public API Gateway in ${this.stackId}`);

    // Public API URL
    this.exportReference(this, 'publicApiUrl', stage.urlForPath('/'), `URL of the Public API Gateway in ${this.stackId}`);

    // Bind resolvers to app scope for other stacks to consume
    scope.resolvePublicApiId = this.resolvePublicApiId.bind(this);
    scope.resolvePublicApiUrl = this.resolvePublicApiUrl.bind(this);
  }

  getPublicApi() {
    return this.publicApiCoreNestedStack.publicApi;
  }

  // Resolve functions for resources
  resolvePublicApiId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicApiId'));
  }

  resolvePublicApiUrl(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicApiUrl'));
  }

}

module.exports = {
  createPublicApiStack,
};
