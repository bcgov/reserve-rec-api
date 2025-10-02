const CONSTANTS = {
  // App Constants
  APP_NAME: 'ReserveRecApi',
  SSM_CONTEXT_PARAM_NAME: 'context',
  SSM_EXPORT_SUFFIX: 'SSMParam',
  // Stacks
  STACKS: {
    // Core Stack
    CORE_STACK: {
      STACK_NAME: 'CoreStack',
      BASE_LAYER_NAME: 'BaseLayer'
    },
    // Admin Identity Stack
    ADMIN_IDENTITY_STACK: {
      STACK_NAME: 'AdminIdentityStack',
      ADMIN_USER_POOL_NAME: 'AdminUserPool',
      ADMIN_USER_POOL_CLIENT_NAME: 'AdminUserPoolClient',
      ADMIN_USER_POOL_DOMAIN_NAME: 'AdminUserPoolDomain',
      AZURE_APP_CLIENT_NAME: 'AzureAppClient',
      AZURE_OIDC_PROVIDER_NAME: 'AzureOIDCProvider',
      BCSC_OIDC_PROVIDER_NAME: 'BCSCOIDCProvider',
      IDENTITY_POOL_NAME: 'IdentityPool',
      COGNITO_AUTHENTICATED_ROLE_NAME: 'CognitoAuthenticatedRole',
      COGNITO_UNAUTHENTICATED_ROLE_NAME: 'CognitoUnauthenticatedRole',
      COGNITO_DOMAIN_PREFIX: 'reserve-rec-admin-identity',
      ADMINISTRATOR_GROUP_NAME: 'Administrators',
      PARK_OPERATOR_GROUP_NAME: 'ParkOperators'
    },
    // Public Identity Stack
    PUBLIC_IDENTITY_STACK: {
      STACK_NAME: 'PublicIdentityStack',
      PUBLIC_USER_POOL_NAME: 'PublicUserPool',
      PUBLIC_USER_POOL_CLIENT_NAME: 'PublicUserPoolClient',
      PUBLIC_USER_POOL_DOMAIN_NAME: 'PublicUserPoolDomain',
      COGNITO_AUTHENTICATED_ROLE_NAME: 'CognitoAuthenticatedRole',
      COGNITO_UNAUTHENTICATED_ROLE_NAME: 'CognitoUnauthenticatedRole',
      COGNITO_DOMAIN_PREFIX: 'reserve-rec-public-identity',
      IDENTITY_POOL_NAME: 'IdentityPool',
    },
    // Admin API Stack
    ADMIN_API_STACK: {
      STACK_NAME: 'AdminApiStack',
      STAGE_NAME: 'api',
      ADMIN_API_NAME: 'AdminApi',
      ADMIN_AUTHORIZER_FUNCTION_NAME: 'AdminAuthorizerFunction'
    },
  }
};

module.exports = {
  CONSTANTS,
};
