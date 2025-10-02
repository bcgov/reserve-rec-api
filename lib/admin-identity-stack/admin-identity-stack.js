const { Stack, RemovalPolicy } = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const { createConstruct, exportValue, exportToSSM, getContextFromSSM, getSyncSecretFromSM, logger, stackNamer } = require('../utils');
const contextDefaults = require('./default-context.json');

class AdminIdentityStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const stackConstants = props?.CONSTANTS?.STACKS?.ADMIN_IDENTITY_STACK;

    // Create an administrative Cognito User Pool
    const adminUserPoolName = stackConstants?.ADMIN_USER_POOL_NAME;
    const adminUserPool = createConstruct(this, adminUserPoolName, {
      createFn: (id) => new cognito.UserPool(this, id, {
        userPoolName: id,
        selfSignUpEnabled: false,
        deletionProtection: props?.POOL_DELETION_PROTECTION ? true : false,
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        removalPolicy: RemovalPolicy.DESTROY
      }),
      exportFn: (construct) => exportValue(this, adminUserPoolName, {
        value: construct.userPoolId,
        pathSuffix: 'userPoolId',
        ...props,
      }),
      ...props
    });

    // Create Azure OIDC provider (using AzureIDIR as the provider name override)
    const azureOIDCProviderName = stackConstants?.AZURE_OIDC_PROVIDER_NAME;
    const azureOIDCProvider = createConstruct(this, azureOIDCProviderName, {
      // Creation function
      createFn: (id) => new cognito.UserPoolIdentityProviderOidc(this, id, {
        userPool: adminUserPool,
        name: id,
        clientId: props.AZURE_CLIENT_ID,
        clientSecret: props.secrets.AZURE_CLIENT_SECRET,
        attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
        issuerUrl: props.AZURE_ISSUER_URL,
        scopes: ['openid', 'profile', 'email'],
        attributeMapping: {
          email: cognito.ProviderAttribute.other("email"),
        }
      }),
      // OIDC providers have a character limit on names, so we cannot use systematic export namer here
      constructNameOverride: azureOIDCProviderName,
      ...props
    });

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
    const azureAppClientName = stackConstants?.AZURE_APP_CLIENT_NAME;
    const azureAppClient = createConstruct(this, azureAppClientName, {
      createFn: (id) => new cognito.UserPoolClient(this, id, {
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
          callbackUrls: props.AZURE_CALLBACK_URLS,
          logoutUrls: props.AZURE_LOGOUT_URLS
        },
        allowedOAuthFlows: [props.ALLOWED_OAUTH_FLOWS],
        enableTokenRevocation: true,
      }),
      exportFn: (construct) => exportValue(this, azureAppClientName, {
        value: construct.userPoolClientId,
        pathSuffix: 'userPoolClientId',
        ...props
      }),
      ...props
    });

    // Create an identity pool
    const identityPoolName = stackConstants?.IDENTITY_POOL_NAME;
    const identityPool = createConstruct(this, identityPoolName, {
      createFn: (id) => new cognito.CfnIdentityPool(this, id, {
        identityPoolName: id,
        allowUnauthenticatedIdentities: false,
        cognitoIdentityProviders: [
          {
            clientId: azureAppClient.userPoolClientId,
            providerName: adminUserPool.userPoolProviderName,
          }
        ]
      }),
      exportFn: (construct) => exportValue(this, identityPoolName, {
        value: construct.ref,
        pathSuffix: 'ref',
        ...props
      }),
      ...props
    });

    // Create a user pool domain
    const userPoolDomainName = stackConstants?.ADMIN_USER_POOL_DOMAIN_NAME;
    const userPoolDomain = createConstruct(this, userPoolDomainName, {
      createFn: (id) => new cognito.UserPoolDomain(this, id, {
        userPool: adminUserPool,
        cognitoDomain: {
          domainPrefix: `${props.COGNITO_DOMAIN_PREFIX}-${props?.ENVIRONEMENT_NAME}`
        }
      }),
      exportFn: (construct) => exportToSSM(this, userPoolDomainName, {
        value: `https://${construct.domainName}-${props?.ENVIRONEMENT_NAME}.auth.${props?.AWS_REGION}.amazoncognito.com`,
        pathSuffix: 'domainName',
        ...props
      }),
      ...props
    });

    // Create an authenticated IAM role
    const cognitoAuthenticatedRoleName = stackConstants?.COGNITO_AUTHENTICATED_ROLE_NAME;
    const cognitoAuthenticatedRole = createConstruct(this, cognitoAuthenticatedRoleName, {
      createFn: (id) => new iam.Role(this, id, {
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
      }),
      ...props,
    });

    // Create an unauthenticated IAM role
    const cognitoUnauthenticatedRoleName = stackConstants?.COGNITO_UNAUTHENTICATED_ROLE_NAME;
    const cognitoUnauthenticatedRole = createConstruct(this, cognitoUnauthenticatedRoleName, {
      createFn: (id) => new iam.Role(this, id, {
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
      }),
      ...props,
    });

    // Attach roles to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoleAttachment", {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: cognitoAuthenticatedRole.roleArn,
        unauthenticated: cognitoUnauthenticatedRole.roleArn
      }
    });

    // Create a Cognito user group for system administrators
    const administratorGroupName = stackConstants?.ADMINISTRATOR_GROUP_NAME;
    const adminGroup = createConstruct(this, administratorGroupName, {
      createFn: (id) => new cognito.CfnUserPoolGroup(this, id, {
        groupName: id,
        userPoolId: adminUserPool.userPoolId,
        description: 'System administrators group',
        precedence: 1
      }),
      ...props
    });

    // Create a Cognito user group for Park Operators
    const parkOperatorsGroupName = stackConstants?.PARK_OPERATOR_GROUP_NAME;
    const parkOperatorsGroup = createConstruct(this, parkOperatorsGroupName, {
      createFn: (id) => new cognito.CfnUserPoolGroup(this, id, {
        groupName: id,
        userPoolId: adminUserPool.userPoolId,
        description: 'Park operators group',
        precedence: 2
      }),
      ...props
    });
  }
}

async function createAdminIdentityStack(app, stackName, context) {
  try {
    logger.info(`Creating Admin Identity Stack (${stackName}, ${context.ENVIRONMENT_NAME})`);
    // get environment configuration
    context = { ...contextDefaults, ...await getContextFromSSM(stackName, context), ...context };
    context['STACK_NAME'] = stackName; // ensure stack name is included in context

    // Get secrets from Secrets Manager and add to context
    // UserPools currently do not support runtime Secrets Manager integration for OIDC client secrets.
    // Therefore we must retrieve the secret value at synthesis time and provide it in plaintext.
    // TODO: Fix this for prod. We should not be getting secrets in plaintext for prod. There are workarounds.
    const secrets = {
      AZURE_CLIENT_SECRET: await getSyncSecretFromSM(context.AZURE_CLIENT_SECRET_NAME, context),
      BCSC_CLIENT_SECRET: await getSyncSecretFromSM(context.BCSC_CLIENT_SECRET_NAME, context)
    };
    context['secrets'] = secrets;

    const stack = new AdminIdentityStack(app, stackNamer(stackName, context), {
      description: `Admin Identity Stack for ${context?.CONSTANTS?.APP_NAME} - ${context.ENVIRONMENT_NAME} environment`,
      ...context
    });

    logger.info(`${stackName} setup complete.\n`);
    return stack;

  } catch (error) {
    logger.error(`Error creating Admin Identity Stack (${stackName}, ${context.ENVIRONMENT_NAME}): \n ${error}\n Stack may not have created properly.`);
  }

}

module.exports = { createAdminIdentityStack };