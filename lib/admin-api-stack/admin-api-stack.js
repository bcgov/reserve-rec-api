const { logger } = require("../helpers/utils");
const apigw = require("aws-cdk-lib/aws-apigateway");

const { StackPrimer }                    = require("../helpers/stack-primer");
const { BaseStack }                      = require("../helpers/base-stack");
const { ActivitiesConstruct }            = require("../../src/handlers/activities/constructs");
const { AdminBookingsConstruct }         = require("../../src/handlers/bookings/constructs");
const { AdminFacilitiesConstruct }       = require("../../src/handlers/facilities/constructs");
const { AdminProductsConstruct }         = require("../../src/handlers/products/constructs");
const { GeozonesConstruct }              = require("../../src/handlers/geozones/constructs");
const { ProductDatesConstruct }          = require("../../src/handlers/productDates/constructs");
const { UsersConstruct }                 = require("../../src/handlers/users/constructs");
const { VerifyConstruct }                = require("../../src/handlers/verify/constructs");

// Nested stacks for each major domain area to reduce resource count in the root stack and improve organization
const { AdminApiCoreNestedStack }        = require("./admin-api-core-nested-stack/admin-api-core-nested-stack");
const { AdminConfigNestedStack }         = require("./admin-config-nested-stack/admin-config-nested-stack");
const { AdminSearchNestedStack }         = require("./admin-search-nested-stack/admin-search-nested-stack");
const { ActivitiesNestedStack }          = require("./admin-activities-nested-stack/admin-activities-nested-stack");
const { BCSCNestedStack }                = require("./admin-bcsc-nested-stack/admin-bcsc-nested-stack");
const { BookingsNestedStack }            = require("./admin-bookings-nested-stack/admin-bookings-nested-stack");
const { FacilitiesNestedStack }          = require("./admin-facilities-nested-stack/admin-facilities-nested-stack");
const { FeatureFlagsNestedStack }        = require("./admin-feature-flags-nested-stack/admin-feature-flags-nested-stack");
const { GeozonesNestedStack }            = require("./admin-geozones-nested-stack/admin-geozones-nested-stack");
const { PoliciesNestedStack }            = require("./admin-policies-nested-stack/admin-policies-nested-stack");
const { ProductManagementNestedStack }   = require("./admin-product-management-nested-stack/admin-product-management-nested-stack");
const { ProductsNestedStack }            = require("./admin-products-nested-stack/admin-products-nested-stack");
const { RelationshipsNestedStack }       = require("./admin-relationships-nested-stack/admin-relationships-nested-stack");
const { PingNestedStack }                = require("./admin-ping-nested-stack/admin-ping-nested-stack");
const { ReportsNestedStack }             = require("./admin-reports-nested-stack/admin-reports-nested-stack");
const { UsersNestedStack }               = require("./admin-users-nested-stack/admin-users-nested-stack");
const { VerifyNestedStack }              = require("./admin-verify-nested-stack/admin-verify-nested-stack");
const { AdminWaitingRoomNestedStack } = require('./admin-waiting-room-nested-stack/admin-waiting-room-nested-stack');

const defaults = {
  description:
    "Admin API stack providing an administrative API Gateway, authorization, and Lambda functions for managing the Reserve Recreation APIs.",
  constructs: {
    adminBookingsConstruct:         { name: "AdminBookingsConstruct" },
    adminFacilitiesConstruct:       { name: "AdminFacilitiesConstruct" },
    adminProductsConstruct:         { name: "AdminProductsConstruct" },
    activitiesConstruct:            { name: "ActivitiesConstruct" },
    geozonesConstruct:              { name: "GeozonesConstruct" },
    productDatesConstruct:          { name: "ProductDatesConstruct" },
    usersConstruct:                 { name: "UsersConstruct" },
    verifyConstruct:                { name: "VerifyConstruct" },

    adminApiCoreNestedStack:        { name: "AdminApiCoreNestedStack" },
    adminConfigNestedStack:         { name: "AdminConfigNestedStack" },
    adminPingNestedStack:           { name: "AdminPingNestedStack" },
    adminSearchNestedStack:         { name: "AdminSearchNestedStack" },
    activitiesNestedStack:          { name: "ActivitiesNestedStack" },
    bcscNestedStack:                { name: "BCSCNestedStack" },
    bookingsNestedStack:            { name: "BookingsNestedStack" },
    facilitiesNestedStack:          { name: "FacilitiesNestedStack" },
    featureFlagsNestedStack:        { name: "FeatureFlagsNestedStack" },
    geozonesNestedStack:            { name: "GeozonesNestedStack" },
    policiesNestedStack:            { name: "PoliciesNestedStack" },
    productManagementStack:         { name: "ProductManagementStack" },
    productsNestedStack:            { name: "ProductsNestedStack" },
    relationshipsNestedStack:       { name: "RelationshipsNestedStack" },
    reportsNestedStack:             { name: "ReportsNestedStack" },
    usersNestedStack:               { name: "UsersNestedStack" },
    verifyNestedStack:              { name: "VerifyNestedStack" },
    waitingRoomAdminNestedStack: { name: "WaitingRoomAdminNestedStack" },
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
    logLevel: process.env.LOG_LEVEL || "info",
    adminApiStageName: "api",
    inheritAdminUserPoolSettingsFromDeployment: "true",
    adminUserPoolId: "",
    adminUserPoolClientId: "",
    bcscKeyId: "",
    opensearchReferenceDataIndexName: "",
    opensearchTransactionalDataIndexName: "",
    opensearchUserIndexName: "",
    viewerFunctionName: "",

    // Feature flags for selective deployment. These will allow you 
    // to deploy the admin API with only certain endpoints enabled, which can
    // be useful for sandbox environments or gradual rollout of new features
    enablePing: process.env.ENABLE_PING !== "false",
    enableBcsc: process.env.ENABLE_BCSC !== "false",
    enableConfig: process.env.ENABLE_CONFIG !== "false",
    enableSearch: process.env.ENABLE_SEARCH !== "false",
    enableGeozones: process.env.ENABLE_GEOZONES !== "false",
    enableFacilities: process.env.ENABLE_FACILITIES !== "false",
    enableActivities: process.env.ENABLE_ACTIVITIES !== "false",
    enableProducts: process.env.ENABLE_PRODUCTS !== "false",
    enablePolicies: process.env.ENABLE_POLICIES !== "false",
    enableReports: process.env.ENABLE_REPORTS !== "false",
    enableRelationships: process.env.ENABLE_RELATIONSHIPS !== "false",
    enableFeatureFlags: process.env.ENABLE_FEATURE_FLAGS !== "false",
    enableUsers: process.env.ENABLE_USERS !== "false",
    enableBookings: process.env.ENABLE_BOOKINGS !== "false",
    enableVerify: process.env.ENABLE_VERIFY !== "false",
    enableProductManagement: process.env.ENABLE_PRODUCT_MANAGEMENT !== "false",
    enableWaitingRoom: process.env.ENABLE_WAITING_ROOM !== 'false',
  },
  secrets: {
    qrSecretKey: {
      name: "qrSecretKey",
    },
  },
};

async function createAdminApiStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new AdminApiStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Admin Api Stack: ${error}`);
  }
}

class AdminApiStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Admin API Stack: ${this.stackId}`);

    // SAM local development vs AWS deployment flag
    const isLocal = this.node.tryGetContext("@context") === "local";

    // Resolve Layers
    const baseLayer                  = scope.resolveBaseLayer(this);
    const awsUtilsLayer              = scope.resolveAwsUtilsLayer(this);
    const opensearchDomainArn        = scope.resolveOpenSearchDomainArn(this);
    const openSearchDomainEndpoint   = scope.resolveOpenSearchDomainEndpoint(this);
    const referenceDataTableName     = scope.resolveRefDataTableName(this);
    const transactionalDataTableName = scope.resolveTransDataTableName(this);

    // How the Authorizer determines User Pool settings:
    // If inheritAdminUserPoolSettingsFromDeployment is true, pull from the deployment stack
    // If false, use the values in config.adminUserPoolId and config.adminUserPoolClientId
    // If either of those are blank, look in DynamoDB for the deployment settings
    if (
      this.getConfigValue("inheritAdminUserPoolSettingsFromDeployment") ===
      "true"
    ) {
      // Pull in the user pool settings from the deployment stack
      this.setConfigValue(
        "adminUserPoolId",
        scope.resolveAdminUserPoolId(this),
      );
      this.setConfigValue(
        "adminUserPoolClientId",
        scope.resolveAdminUserPoolClientId(this),
      );
    }

    // Create the core API nested stack
    this.adminApiCoreNestedStack = new AdminApiCoreNestedStack(
      this,
      this.getConstructId("adminApiCoreNestedStack"),
      {
        corsPreflightAllowHeaders: this.getConfigValue(
          "corsPreflightAllowHeaders",
        ),
        corsPreflightMaxAgeSeconds: this.getConfigValue(
          "corsPreflightMaxAgeSeconds",
        ),
        adminApiStageName: this.getConfigValue("adminApiStageName"),
        logLevel: this.getConfigValue("logLevel"),
        adminUserPoolId: this.getConfigValue("adminUserPoolId"),
        adminUserPoolClientId: this.getConfigValue("adminUserPoolClientId"),
        referenceDataTableName: referenceDataTableName,
        baseLayer: baseLayer,
        awsUtilsLayer: awsUtilsLayer,
        refDataTableArn: scope.resolveRefDataTableArn(this),
        appName: this.getAppName(),
        deploymentName: this.getDeploymentName(),
      },
    );

    // Get API identifiers from the core nested stack
    // These are used to import the API into the other nested stacks without
    // creating CDK object references that consume root stack resources
    const adminApiId = this.adminApiCoreNestedStack.getRestApiId();
    const adminApiRootResourceId =
      this.adminApiCoreNestedStack.getRootResourceId();

    // ----- LAMBDAS -----

    // Ping API
    if (this.getConfigValue("enablePing")) {
      this.adminPingNestedStack = new PingNestedStack(
        this,
        this.getConstructId("adminPingNestedStack"),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            API_NAME: this.adminApiCoreNestedStack.adminApi.physicalName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
        },
      );
    }

    // BCSC Lambdas
    if (this.getConfigValue("enableBcsc")) {
      this.bcscNestedStack = new BCSCNestedStack(
        this,
        this.getConstructId("bcscNestedStack"),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            BCSC_KEY_ID: this.getConfigValue("bcscKeyId"),
            API_STAGE: this.getConfigValue("adminApiStageName"),
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
        },
      );
    }

    // Admin Config Getters
    if (this.getConfigValue("enableConfig")) {
      this.adminConfigNestedStack = new AdminConfigNestedStack(
        this,
        this.getConstructId("adminConfigNestedStack"),
        {
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
        },
      );
    }

    // Admin OpenSearch Search Function
    if (this.getConfigValue("enableSearch")) {
      const searchEndpoint = `https://${openSearchDomainEndpoint}`;
      this.adminSearchNestedStack = new AdminSearchNestedStack(
        this,
        this.getConstructId("adminSearchNestedStack"),
        {
          opensearchDomainArn: opensearchDomainArn,
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            OPENSEARCH_DOMAIN_ENDPOINT: searchEndpoint,
            OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.getConfigValue(
              "opensearchReferenceDataIndexName",
            ),
            OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: this.getConfigValue(
              "opensearchTransactionalDataIndexName",
            ),
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
          authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        },
      );
    }

    // Geozone Lambdas
    if (this.getConfigValue("enableGeozones")) {
      const geozonesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
        handlerPrefix: "admin",
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.geozonesConstruct = new GeozonesConstruct(
          this,
          this.getConstructId("geozonesConstruct"),
          geozonesProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.geozonesNestedStack = new GeozonesNestedStack(
          this,
          this.getConstructId("geozonesNestedStack"),
          geozonesProps,
        );
        this.geozonesConstruct = this.geozonesNestedStack.geozonesConstruct;
      }
    }

    // Facilities Lambdas
    if (this.getConfigValue("enableFacilities")) {
      const facilitiesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.adminFacilitiesConstruct = new AdminFacilitiesConstruct(
          this,
          this.getConstructId("adminFacilitiesConstruct"),
          facilitiesProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.facilitiesNestedStack = new FacilitiesNestedStack(
          this,
          this.getConstructId("facilitiesNestedStack"),
          facilitiesProps,
        );
        this.adminFacilitiesConstruct =
          this.facilitiesNestedStack.adminFacilitiesConstruct;
      }
    }

    // Activities Lambdas
    if (this.getConfigValue("enableActivities")) {
      const activitiesProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
        handlerPrefix: "admin",
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.activitiesConstruct = new ActivitiesConstruct(
          this,
          this.getConstructId("activitiesConstruct"),
          activitiesProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.activitiesNestedStack = new ActivitiesNestedStack(
          this,
          this.getConstructId("activitiesNestedStack"),
          activitiesProps,
        );
        this.activitiesConstruct =
          this.activitiesNestedStack.activitiesConstruct;
      }
    }

    // Products Lambdas
    if (this.getConfigValue("enableProducts")) {
      const productsProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.adminProductsConstruct = new AdminProductsConstruct(
          this,
          this.getConstructId("adminProductsConstruct"),
          productsProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.productsNestedStack = new ProductsNestedStack(
          this,
          this.getConstructId("productsNestedStack"),
          productsProps,
        );
        this.adminProductsConstruct =
          this.productsNestedStack.adminProductsConstruct;
      }
    }

    // Policies Lambdas
    if (this.getConfigValue("enablePolicies")) {
      this.policiesNestedStack = new PoliciesNestedStack(
        this,
        this.getConstructId("policiesNestedStack"),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
          authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
          handlerPrefix: "admin",
        },
      );
    }

    // Users Lambdas
    if (this.getConfigValue("enableUsers")) {
      const searchEndpoint = `https://${openSearchDomainEndpoint}`;
      const usersProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
          OPENSEARCH_DOMAIN_ENDPOINT: searchEndpoint,
          OPENSEARCH_USER_INDEX_NAME: this.getConfigValue(
            "opensearchUserIndexName",
          ),
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
        openSearchDomainArn: opensearchDomainArn,
      };
      
      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        logger.info(
          "Local context detected - using flat UsersConstruct for SAM compatibility",
        );
        this.usersConstruct = new UsersConstruct(
          this,
          this.getConstructId("usersConstruct"),
          usersProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        logger.info(
          "AWS deployment context - using UsersNestedStack to reduce resource count",
        );
        this.usersNestedStack = new UsersNestedStack(
          this,
          this.getConstructId("usersNestedStack"),
          usersProps,
        );
        // For compatibility with existing code that references this.usersConstruct
        this.usersConstruct = this.usersNestedStack.usersConstruct;
      }
    }

    if (this.getConfigValue("enableProductManagement")) {
      const productManagementProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
        openSearchDomainArn: opensearchDomainArn,
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        logger.info(
          "Local context detected - using flat ProductDatesConstruct for SAM compatibility",
        );
        this.productDatesConstruct = new ProductDatesConstruct(
          this,
          this.getConstructId("productDatesConstruct"),
          productManagementProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        logger.info(
          "AWS deployment context - using ProductManagementNestedStack to reduce resource count",
        );
        this.productManagementStack = new ProductManagementNestedStack(
          this,
          this.getConstructId("productManagementStack"),
          productManagementProps,
        );
        this.productDatesConstruct =
          this.productManagementStack.productDatesConstruct;
      }
    }

    // Bookings Lambdas
    if (this.getConfigValue("enableBookings")) {
      const bookingsProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
        handlerPrefix: "admin",
        openSearchDomainArn: opensearchDomainArn,
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        logger.info(
          "Local context detected - using flat AdminBookingsConstruct for SAM compatibility",
        );
        this.adminBookingsConstruct = new AdminBookingsConstruct(
          this,
          this.getConstructId("adminBookingsConstruct"),
          bookingsProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        logger.info(
          "AWS deployment context - using BookingsNestedStack to reduce resource count",
        );
        this.bookingsNestedStack = new BookingsNestedStack(
          this,
          this.getConstructId("bookingsNestedStack"),
          bookingsProps,
        );
        // For compatibility with existing code that references this.adminBookingsConstruct
        this.adminBookingsConstruct =
          this.bookingsNestedStack.adminBookingsConstruct;
      }
    }

    // Verify Lambdas (QR code verification)
    if (this.getConfigValue("enableVerify")) {
      const verifyProps = {
        environment: {
          LOG_LEVEL: this.getConfigValue("logLevel"),
          REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
          QR_SECRET_KEY: this.getSecretValue("qrSecretKey"),
          PUBLIC_FRONTEND_DOMAIN: scope.resolvePublicDomainName(this),
        },
        layers: [baseLayer, awsUtilsLayer],
        // For local/SAM: pass the objects. For Nested: pass the imported API.
        api: isLocal ? this.adminApiCoreNestedStack.adminApi : null,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
      };

      // For local, use the flat construct for SAM compatibility.
      if (isLocal) {
        this.verifyConstruct = new VerifyConstruct(
          this,
          this.getConstructId("verifyConstruct"),
          verifyProps,
        );
      } else {
        // For AWS deployments, use the nested stack to reduce resource count
        // in the root stack
        this.verifyNestedStack = new VerifyNestedStack(
          this,
          this.getConstructId("verifyNestedStack"),
          verifyProps,
        );
        this.verifyConstruct = this.verifyNestedStack.verifyConstruct;
      }
    }

    // Reports Lambdas (Daily Passes Report)
    if (this.getConfigValue("enableReports")) {
      this.reportsNestedStack = new ReportsNestedStack(
        this,
        this.getConstructId("reportsNestedStack"),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
            TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
          authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        },
      );
    }

    // Relationship Lambdas
    if (this.getConfigValue("enableRelationships")) {
      this.relationshipsNestedStack = new RelationshipsNestedStack(
        this,
        this.getConstructId("relationshipsNestedStack"),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
          authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
          handlerPrefix: "admin",
        },
      );
    }

    // Feature Flags Lambdas
    if (this.getConfigValue("enableFeatureFlags")) {
      this.featureFlagsNestedStack = new FeatureFlagsNestedStack(
        this,
        this.getConstructId("featureFlagsNestedStack"),
        {
          environment: {
            LOG_LEVEL: this.getConfigValue("logLevel"),
            REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
          },
          layers: [baseLayer, awsUtilsLayer],
          restApiId: adminApiId,
          rootResourceId: adminApiRootResourceId,
          authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        },
      );
    }

    // Waiting Room Admin Lambdas
    if (this.getConfigValue('enableWaitingRoom')) {
      this.waitingRoomAdminNestedStack = new AdminWaitingRoomNestedStack(this, this.getConstructId('waitingRoomAdminNestedStack'), {
        environment: {
          LOG_LEVEL: this.getConfigValue('logLevel'),
        },
        layers: [
          baseLayer,
          awsUtilsLayer,
        ],
        restApiId: adminApiId,
        rootResourceId: adminApiRootResourceId,
        authorizer: this.adminApiCoreNestedStack.getAuthorizer(),
        waitingRoomTableName: scope.resolveWaitingRoomTableName(),
        waitingRoomTableArn: scope.resolveWaitingRoomTableArn(),
        releaseLambdaArn: scope.resolveReleaseLambdaArn(),
        viewerFunctionName: this.getConfigValue('viewerFunctionName') || '',
        wsManagementEndpoint: scope.resolveWsManagementEndpoint ? scope.resolveWsManagementEndpoint() : '',
      });
    }

    // Ensure API redeployment when nested stacks are updated
    // Since API Gateway Resources/Methods are now in nested stacks (not the root stack),
    // CDK doesn't automatically track their changes for redeployment.
    // We explicitly add dependencies so the deployment updates when spoke stacks change.
    const nestedStacks = [
      isLocal ? null : this.geozonesNestedStack,
      isLocal ? null : this.facilitiesNestedStack,
      isLocal ? null : this.activitiesNestedStack,
      isLocal ? null : this.productsNestedStack,
      isLocal ? null : this.usersNestedStack,
      isLocal ? null : this.bookingsNestedStack,
      isLocal ? null : this.verifyNestedStack,
      isLocal ? null : this.productManagementStack,
      isLocal ? null : this.waitingRoomAdminNestedStack,
      isLocal ? null : this.policiesNestedStack,
      isLocal ? null : this.reportsNestedStack,
      isLocal ? null : this.relationshipsNestedStack,
      isLocal ? null : this.featureFlagsNestedStack,
      isLocal ? null : this.adminPingNestedStack,
      isLocal ? null : this.bcscNestedStack,
      isLocal ? null : this.adminConfigNestedStack,
      isLocal ? null : this.adminSearchNestedStack,
    ].filter((stack) => stack !== null);

    // Create a unique deployment name using the current timestamp to force
    // redeployment when needed. This is required to workaround the fact that
    // CDK doesn't detect changes in nested stacks for API Gateway deployments
    const now = new Date().toISOString();
    
    // Create a Deployment that depends on all nested stacks
    const deployment = new apigw.Deployment(this, `Deployment-${now}`, {
      api: this.adminApiCoreNestedStack.adminApi,
    });

    // Add the dependencies to the deployment manually
    // This tells CloudFormation to not run this deployment until all these
    // stacks are done and good to go.
    nestedStacks.forEach((nestedStack) => {
      if (nestedStack) {
        deployment.node.addDependency(nestedStack);
      }
    });

    // Create the Stage attached to that deployment
    new apigw.Stage(this, "AdminApiStage", {
      deployment: deployment,
      stageName: this.getConfigValue("adminApiStageName"),
      loggingLevel: apigw.MethodLoggingLevel.INFO,
      dataTraceEnabled: true,
    });

    // Bind resolvers to scope for other stacks to consume
    scope.resolveAdminApiId = this.resolveAdminApiId.bind(this);
    scope.resolveAdminApiUrl = this.resolveAdminApiUrl.bind(this);
    // Return the actual API instead of calling a reference from SSM
    // This is for constructs within the same deployment that need direct access, like lambdas.
    scope.getAdminApi = this.getAdminApi.bind(this);
  }

  // Getters for resources
  getAdminApi() {
    return this.adminApiCoreNestedStack.adminApi;
  }

  // Resolve functions for resources
  resolveAdminApiId(consumerScope) {
    return this.resolveReference(
      consumerScope,
      this.getExportSSMPath("adminApiId"),
    );
  }

  resolveAdminApiUrl(consumerScope) {
    return this.resolveReference(
      consumerScope,
      this.getExportSSMPath("adminApiUrl"),
    );
  }
}

module.exports = {
  createAdminApiStack,
};
