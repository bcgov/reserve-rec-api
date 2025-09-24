const { Stack, RemovalPolicy } = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const { createConstruct, exportToSSM, getContextFromSSM, getSyncSecretFromSM, logger, stackNamer } = require('../utils');
const { APP_NAME } = require('../constants');
const contextDefaults = require('./default-context.json');

class AdminIdentityStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    try {

      const context = props.context;

      // Create an administrative Cognito User Pool
      const adminUserPool = createConstruct(this, 'ADMIN_USER_POOL_NAME', context,
        // Creation function
        (id) => new cognito.UserPool(this, id, {
          userPoolName: id,
          selfSignUpEnabled: false,
          deletionProtection: context?.POOL_DELETION_PROTECTION ? true : false,
          accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
          removalPolicy: RemovalPolicy.DESTROY
        }),
        // Import function
        (id, importRef) => cognito.UserPool.fromUserPoolId(this, id, importRef),
        // Export function
        (construct) => exportToSSM(this, 'ADMIN_USER_POOL_NAME', construct.userPoolId, 'userPoolId', context)
      );

      // Create Azure OIDC provider (using AzureIDIR as the provider name override)
      const azureOIDCProvider = createConstruct(this, 'AzureIDIR', context,
        // Creation function
        (id) => new cognito.UserPoolIdentityProviderOidc(this, id, {
          userPool: adminUserPool,
          name: id,
          clientId: context.AZURE_CLIENT_ID,
          clientSecret: context.AZURE_CLIENT_SECRET,
          attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
          issuerUrl: context.AZURE_ISSUER_URL,
          scopes: [ 'openid', 'profile', 'email' ],
          attributeMapping: {
            email: cognito.ProviderAttribute.other("email"),
          }
        })
      );

      // // Create BSCS OIDC provider
      // const bscsOIDCProvider = createConstruct(this, 'BCSC_OIDC_PROVIDER_NAME', context,
      //   // Creation function
      //   (id) => new cognito.UserPoolIdentityProviderOidc(this, id, {
      //     userPool: adminUserPool,
      //     clientId: context.BCSC_CLIENT_ID,
      //     clientSecretValue: getSecretFromSM(this, context.BCSC_CLIENT_SECRET_NAME, context),
      //     attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
      //     issuerUrl: context.BCSC_ISSUER,
      //   })
      // );

      // Create an app client for the user pool
      const azureAppClient = createConstruct(this, 'AZURE_APP_CLIENT_NAME', context,
        // Creation function
        (id) => new cognito.UserPoolClient(this, id, {
          userPool: adminUserPool,
          generateSecret: false,
          authFlows: {
            userPassword: true,
            userSrp: true,
          },
          oAuth: {
            flows: {
              authorizationCodeGrant: true,
              implicitCodeGrant: true,
            },
            scopes: [
              cognito.OAuthScope.OPENID,
              cognito.OAuthScope.EMAIL,
            ],
            callbackUrls: context.AZURE_CALLBACK_URLS,
            logoutUrls: context.AZURE_LOGOUT_URLS
          },
          allowedOAuthFlows: [context.ALLOWED_OAUTH_FLOWS],
          enableTokenRevocation: true,
        }),
        // Import function
        null,
        // Export function
        (construct) => exportToSSM(this, 'AZURE_APP_CLIENT_NAME',  construct.userPoolClientId, 'userPoolClientId', context)
      );

      // Create an identity pool
      const identityPool = createConstruct(this, 'ADMIN_IDENTITY_POOL_NAME', context,
        // Creation function
        (id) => new cognito.CfnIdentityPool(this, id, {
          identityPoolName: id,
          allowUnauthenticatedIdentities: false,
          cognitoIdentityProviders: [
            {
              clientId: azureAppClient.userPoolClientId,
              providerName: adminUserPool.userPoolProviderName,
            }
          ]
        }),
        // Import function
        null,
        // Export function
        (construct) => exportToSSM(this, 'ADMIN_IDENTITY_POOL_NAME', construct.ref, 'ref', context)
      );

      // Create a user pool domain
      const userPoolDomain = createConstruct(this, 'ADMIN_USER_POOL_DOMAIN_NAME', context,
        // Creation function
        (id) => new cognito.UserPoolDomain(this, id, {
          userPool: adminUserPool,
          cognitoDomain: {
            domainPrefix: `${context.COGNITO_DOMAIN_PREFIX}-${context?.ENVIRONMENT_NAME}`
          }
        }),
        // Import function
        null,
        // Export function
        (construct) => exportToSSM(this, 'ADMIN_USER_POOL_DOMAIN_NAME', `https://${construct.domainName}-${context?.ENVIRONMENT_NAME}.auth.${context?.AWS_REGION}.amazoncognito.com`, 'domainName', context)
      );

      // Create an authenticated IAM role
      const cognitoAuthenticatedRole = createConstruct(this, 'COGNITO_AUTHENTICATED_ROLE_NAME', context,
        // Creation function
        (id) => new iam.Role(this, id, {
          roleName: id,
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
              'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
            },
            'sts:AssumeRoleWithWebIdentity'
          ),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
          ]
        })
      );

      // Create an unauthenticated IAM role
      const cognitoUnauthenticatedRole = createConstruct(this, 'COGNITO_UNAUTHENTICATED_ROLE_NAME', context,
        // Creation function
        (id) => new iam.Role(this, id, {
          roleName: id,
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
              'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
            },
            'sts:AssumeRoleWithWebIdentity'
          ),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
          ]
        })
      );

      // Attach roles to the identity pool
      new cognito.CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
        identityPoolId: identityPool.ref,
        roles: {
          authenticated: cognitoAuthenticatedRole.roleArn,
          unauthenticated: cognitoUnauthenticatedRole.roleArn
        }
      });

      // Create a Cognito user group for system administrators
      const adminGroup = createConstruct(this, 'ADMINISTRATOR_GROUP_NAME', context,
        // Creation function
        (id) => new cognito.CfnUserPoolGroup(this, id, {
          groupName: id,
          userPoolId: adminUserPool.userPoolId,
          description: 'System administrators group',
          precedence: 1
        })
      );

      // Create a Cognito user group for Park Operators
      const parkOperatorsGroup = createConstruct(this, 'PARK_OPERATOR_GROUP_NAME', context,
        // Creation function
        (id) => new cognito.CfnUserPoolGroup(this, id, {
          groupName: id,
          userPoolId: adminUserPool.userPoolId,
          description: 'Park operators group',
          precedence: 2
        })
      );

    } catch (error) {
      throw error;
    }
  }
}

async function createAdminIdentityStack(app, stackName, appContext) {
  try {
    logger.info(`Creating Admin Identity Stack (${stackName}, ${appContext.ENVIRONMENT_NAME})`);
    // get environment configuration
    // Import env configuration
    let stackConfig = await getContextFromSSM(stackName, appContext);

    // Merge context order:
    // default stack context (default-context.json) <
    // stack config params (SSM ParameterStore or local) <
    // app context (cdk.json)
    let stackContext = { ...contextDefaults, ...stackConfig, ...appContext };
    stackContext.STACK_NAME = stackName; // ensure stack name is included in context

    // Get secrets from Secrets Manager and add to context
    // UserPools currently do not support runtime Secrets Manager integration for OIDC client secrets.
    // Therefore we must retrieve the secret value at synthesis time and provide it in plaintext.
    // TODO: Fix this for prod. We should not be getting secrets in plaintext for prod. There are workarounds.
    stackContext['AZURE_CLIENT_SECRET'] = await getSyncSecretFromSM(stackContext.AZURE_CLIENT_SECRET_NAME, stackContext);
    stackContext['BCSC_CLIENT_SECRET'] = await getSyncSecretFromSM(stackContext.BCSC_CLIENT_SECRET_NAME, stackContext);

    return new AdminIdentityStack(app, stackNamer(stackName, stackContext), {
      context: stackContext,
      description: `Admin Identity Stack for ${APP_NAME} - ${appContext.ENVIRONMENT_NAME} environment`
    });

  } catch (error) {
    logger.error(`Error creating Admin Identity Stack (${stackName}, ${appContext.ENVIRONMENT_NAME}): \n ${error}`);
  }

}

module.exports = { createAdminIdentityStack };