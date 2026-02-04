const { Duration } = require('aws-cdk-lib');
const apigw = require('aws-cdk-lib/aws-apigateway');
const ssm = require('aws-cdk-lib/aws-ssm');
const { logger } = require("../helpers/utils");
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { AdminAuthorizerConstruct } = require("../../src/handlers/authorizers/constructs");
const { PingApiConstruct } = require("../../src/handlers/ping/constructs");
const { AdminSearchLambda } = require("../../src/handlers/search/constructs");
const { AdminConfigLambdas } = require('../../src/handlers/config/constructs');
const { ProtectedAreasConstruct } = require('../../src/handlers/protectedAreas/constructs');
const { GeozonesConstruct } = require('../../src/handlers/geozones/constructs');
const { FacilitiesConstruct } = require('../../src/handlers/facilities/constructs');
const { ActivitiesConstruct } = require('../../src/handlers/activities/constructs');
const { ProductsConstruct } = require('../../src/handlers/products/constructs');
const { UsersConstruct } = require('../../src/handlers/users/constructs');
const { PoliciesConstruct } = require('../../src/handlers/policies/constructs');
const { AdminBookingsConstruct } = require('../../src/handlers/bookings/constructs');
const { BCSCConstruct } = require('../../src/handlers/bcsc/constructs');
const { VerifyConstruct } = require('../../src/handlers/verify/constructs');
const { ReportsConstruct } = require('../../src/handlers/reports/constructs');
const { RelationshipsConstruct } = require('../../src/handlers/relationships/constructs');
const { AdminFeatureFlagsConstruct } = require('../../src/handlers/featureFlags/constructs');


const defaults = {
  description: 'Admin API stack providing an administrative API Gateway, authorization, and Lambda functions for managing the Reserve Recreation APIs.',
  constructs: {
    adminAuthorizer: {
      name: 'AdminAuthorizer',
    },
    adminApi: {
      name: 'AdminApi',
    },
    adminPingApi: {
      name: 'AdminPingApi',
    },
    adminSearchLambda: {
      name: 'AdminSearchLambda',
    },
    adminConfigLambdas: {
      name: 'AdminConfigLambdas'
    },
    adminApiLoggingRole: {
      name: 'AdminApiLoggingRole'
    },
    adminApiLoggingAccount: {
      name: 'AdminApiLoggingAccount'
    },
    adminBookingsConstruct: {
      name: 'AdminBookingsConstruct',
    },
    bcscConstruct: {
      name: 'BCSCConstruct',
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
    productsConstruct: {
      name: 'ProductsConstruct',
    },
    policiesConstruct: {
      name: 'PoliciesConstruct',
    },
    relationshipsConstruct: {
      name: 'RelationshipsConstruct',
    },
    usersConstruct: {
      name: 'UsersConstruct',
    },
    verifyConstruct: {
      name: 'VerifyConstruct',
    },
    reportsConstruct: {
      name: 'ReportsConstruct',
    },
    featureFlagsConstruct: {
      name: 'FeatureFlagsConstruct',
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
    adminApiStageName: 'api',
    inheritAdminUserPoolSettingsFromDeployment: 'true',
    adminUserPoolId: '',
    adminUserPoolClientId: '',
    bcscKeyId: '',
  },
  secrets: {
    qrSecretKey: {
      name: 'qrSecretKey',
    },
  }

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

    // Resolve Layers
    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);
    const opensearchDomainArn = scope.resolveOpenSearchDomainArn(this);
    const referenceDataTableName = scope.resolveRefDataTableName(this);
    const transactionalDataTableName = scope.resolveTransDataTableName(this);

    // How the Authorizer determines User Pool settings:
    // If inheritAdminUserPoolSettingsFromDeployment is true, pull from the deployment stack
    // If false, use the values in config.adminUserPoolId and config.adminUserPoolClientId
    // If either of those are blank, look in DynamoDB for the deployment settings
    if (this.getConfigValue('inheritAdminUserPoolSettingsFromDeployment') === 'true') {
      // Pull in the user pool settings from the deployment stack
      this.setConfigValue('adminUserPoolId', scope.resolveAdminUserPoolId(this));
      this.setConfigValue('adminUserPoolClientId', scope.resolveAdminUserPoolClientId(this));
    }

    // Create the Admin Authorizer for the API Gateway
    this.adminAuthorizerConstruct = new AdminAuthorizerConstruct(this, this.getConstructId('adminAuthorizer'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        ADMIN_USER_POOL_ID: this.getConfigValue('adminUserPoolId') || null,
        ADMIN_USER_POOL_CLIENT_ID: this.getConfigValue('adminUserPoolClientId') || null,
        API_STAGE: this.getConfigValue('adminApiStageName'),
        IS_OFFLINE: scope.isOffline() ? 'true' : 'false',
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ]
    });

    const requestAuthorizer = this.adminAuthorizerConstruct.getRequestAuthorizer();

    // Create the Admin API Gateway
    this.adminApi = new apigw.RestApi(this, this.getConstructId('adminApi'), {
      restApiName: this.getConstructId('adminApi'),
      description: `Admin API for ${this.getAppName()} - ${this.getDeploymentName()} environment`,
      deploy: true,
      defaultCorsPreflightOptions: {
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS, // this is also the default
        allowHeaders: this.getConfigValue('corsPreflightAllowHeaders'),
        maxAge: Duration.seconds(this.getConfigValue('corsPreflightMaxAgeSeconds') || 600) // default to 1 day,
      },
      deployOptions: {
        stageName: this.getConfigValue('adminApiStageName'),
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: false,
      },
    });

    // Attach the authorizer to the API Gateway
    // We need to do this here AND in the api defaultMethodOptions
    requestAuthorizer._attachToApi(this.adminApi);

    // ----- LAMBDAS -----

    // Ping API
    this.adminPingApiConstruct = new PingApiConstruct(this, this.getConstructId('adminPingApi'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        API_NAME: this.adminApi.physicalName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
    });

    // BCSC Lambdas
    this.bcscConstruct = new BCSCConstruct(this, this.getConstructId('bcscConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        BCSC_KEY_ID: this.getConfigValue('bcscKeyId'),
        API_STAGE: this.getConfigValue('adminApiStageName'),
      },
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      api: this.adminApi,
    });

    // Admin Config Getters
    this.adminConfigLambdas = new AdminConfigLambdas(this, this.getConstructId('adminConfigLambdas'), {
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      api: this.adminApi
    });

    // Admin OpenSearch Search Function
    const searchEndpoint = `https://${scope.resolveOpenSearchDomainEndpoint(this)}`;
    this.adminSearchConstruct = new AdminSearchLambda(this, this.getConstructId('adminSearchLambda'), {
      opensearchDomainArn: opensearchDomainArn,
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        OPENSEARCH_DOMAIN_ENDPOINT: searchEndpoint,
        OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.getConfigValue('opensearchReferenceDataIndexName'),
        OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: this.getConfigValue('opensearchTransactionalDataIndexName'),
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
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
      api: this.adminApi,
      authorizer: requestAuthorizer,
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
      api: this.adminApi,
      authorizer: requestAuthorizer,
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
      api: this.adminApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'admin',
    });

    // Activities Lambdas
    this.activitiesConstrcut = new ActivitiesConstruct(this, this.getConstructId('activitiesConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'admin',
    });

    // Products Lambdas
    this.productsConstruct = new ProductsConstruct(this, this.getConstructId('productsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'admin',
    });

    // Users Lambdas
    this.usersConstruct = new UsersConstruct(this, this.getConstructId('usersConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
    });

    // Policies Lambdas
    this.policiesConstruct = new PoliciesConstruct(this, this.getConstructId('policiesConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'admin',
    });

    // Bookings Lambdas
    this.adminBookingsConstruct = new AdminBookingsConstruct(this, this.getConstructId('adminBookingsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'admin',
      openSearchDomainArn: opensearchDomainArn,
    });

    // Verify Lambdas (QR code verification)
    this.verifyConstruct = new VerifyConstruct(this, this.getConstructId('verifyConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
        QR_SECRET_KEY: this.getSecretValue('qrSecretKey'),
        PUBLIC_FRONTEND_DOMAIN: scope.resolvePublicDomainName(this),
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
    });

    // Reports Lambdas (Daily Passes Report)
    this.reportsConstruct = new ReportsConstruct(this, this.getConstructId('reportsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
        TRANSACTIONAL_DATA_TABLE_NAME: transactionalDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
    });

    // Relationship Lambdas
    this.relationshipsConstruct = new RelationshipsConstruct(this, this.getConstructId('relationshipsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
      handlerPrefix: 'admin'
    });

    // Feature Flags Lambdas
    this.featureFlagsConstruct = new AdminFeatureFlagsConstruct(this, this.getConstructId('featureFlagsConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        REFERENCE_DATA_TABLE_NAME: referenceDataTableName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      api: this.adminApi,
      authorizer: requestAuthorizer,
    });

    // Export References

    // Admin API ID
    this.exportReference(this, 'adminApiId', this.adminApi.restApiId, `ID of the Admin API Gateway in ${this.stackId}`);

    // Admin API URL
    this.exportReference(this, 'adminApiUrl', this.adminApi.url, `URL of the Admin API Gateway in ${this.stackId}`);

    // Bind resolvers to scope for other stacks to consume
    scope.resolveAdminApiId = this.resolveAdminApiId.bind(this);
    scope.resolveAdminApiUrl = this.resolveAdminApiUrl.bind(this);
    // Return the actual API instead of calling a reference from SSM
    // This is for constructs within the same deployment that need direct access, like lambdas.
    scope.getAdminApi = this.getAdminApi.bind(this);
  }

  // Getters for resources
  getAdminApi() {
    return this.adminApi;
  }

  // Resolve functions for resources
  resolveAdminApiId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('adminApiId'));
  }

  resolveAdminApiUrl(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('adminApiUrl'));
  }

}

module.exports = {
  createAdminApiStack,
};
