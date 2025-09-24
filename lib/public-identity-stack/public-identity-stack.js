const { exportToSSM, getContextFromSSM, logger, stackNamer, createConstruct } = require('../utils');
const { Stack, RemovalPolicy, Duration } = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const contextDefaults = require('./default-context.json');
const { APP_NAME } = require('../constants');

// Load CSS file for Cognito User Pool UI customization
const fs = require('fs');
const path = require('path');
const cssPath = path.join(__dirname, 'cognito-ui-styling.css');
const userPoolStyling = fs.readFileSync(cssPath, 'utf8');

class PublicIdentityStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    try {

      const context = props.context;

      // Create a public Cognito User Pool
      const publicUserPool = createConstruct(this, 'PUBLIC_USER_POOL_NAME', context,
        // Creation function
        (id) => new cognito.UserPool(this, id, {
          userPoolName: id,
          autoVerify: { email: true },
          accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
          userVerification: {
            emailStyle: cognito.VerificationEmailStyle.CODE,
          },
          selfSignUpEnabled: true,
          standardAttributes: {
            email: {
              required: true,
              mutable: true,
            },
          },
          userAttributeUpdateSettings: {
            attributesRequireVerificationBeforeUpdate: ['email'],
          },
          deletionProtection: context?.POOL_DELETION_PROTECTION ? true : false,
          removalPolicy: RemovalPolicy.DESTROY
        }),
        // Import function
        (id, importRef) => cognito.UserPool.fromUserPoolId(this, id, importRef),
        // Export function
        (construct) => exportToSSM(this, 'PUBLIC_USER_POOL_NAME', construct.userPoolId, 'userPoolId', context)
      );

      // Set up User Pool Domain for public users
      const userPoolDomain = createConstruct(this, 'PUBLIC_USER_POOL_DOMAIN_NAME', context,
        // Creation function
        (id) => new cognito.UserPoolDomain(this, id, {
          userPool: publicUserPool,
          cognitoDomain: {
            domainPrefix: `${context.COGNITO_DOMAIN_PREFIX}-${context.ENVIRONMENT_NAME}`
          }
        }),
        // Import function
        null,
        // Export function
        (construct) => exportToSSM(this, 'PUBLIC_USER_POOL_DOMAIN_NAME', `https://${construct.domainName}-${context?.ENVIRONMENT_NAME}.auth.${context?.AWS_REGION}.amazoncognito.com`, 'domainName', context)
      );

      // Setup Cognito User Pool Client for public users
      const publicUserPoolClient = createConstruct(this, 'PUBLIC_USER_POOL_CLIENT_NAME', context,
        // Creation function
        (id) => new cognito.UserPoolClient(this, id, {
          userPool: publicUserPool,
          userPoolClientName: id,
          supportedIdentityProviders: [
            cognito.UserPoolClientIdentityProvider.COGNITO,
          ],
          generateSecret: false,
          selfSignUpEnabled: true,
          oAuth: {
            flows: {
              authorizationCodeGrant: true,
            },
            scopes: [
              cognito.OAuthScope.EMAIL,
              cognito.OAuthScope.OPENID,
              cognito.OAuthScope.PROFILE,
              cognito.OAuthScope.COGNITO_ADMIN,
            ],
            callbackUrls: context.PUBLIC_COGNITO_CALLBACK_URLS,
            logoutUrls: context.PUBLIC_COGNITO_LOGOUT_URLS,
          },
          accessTokenValidity: Duration.days(1),
          idTokenValidity: Duration.days(1),
          refreshTokenValidity: Duration.days(30),
        }),
        // Import function
        null,
        // Export function
        (construct) => exportToSSM(this, 'PUBLIC_USER_POOL_CLIENT_NAME', construct.userPoolClientId, 'userPoolClientId', context)
      );

      // Define the authenticated role
      const publicAuthenticatedRole = createConstruct(this, 'COGNITO_AUTHENTICATED_ROLE_NAME', context,
        (id) => new iam.Role(this, id, {
          roleName: id,
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              'StringEquals': { 'cognito-identity.amazonaws.com:aud': publicUserPool.userPoolId },
              'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
            },
            'sts:AssumeRoleWithWebIdentity'
          ),
          managedPolicies: [
            // TODO: Change this to custom roles when we know what public users can do
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
          ]
        })
      );

      // Define the unauthenticated role
      const publicUnauthenticatedRole = createConstruct(this, 'COGNITO_UNAUTHENTICATED_ROLE_NAME', context,
        (id) => new iam.Role(this, id, {
          roleName: id,
          assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
              'StringEquals': { 'cognito-identity.amazonaws.com:aud': publicUserPool.userPoolId },
              'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
            },
            'sts:AssumeRoleWithWebIdentity'
          ),
          managedPolicies: [
            // TODO: Change this to custom roles when we know what public users can do
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoUnAuthedIdentitiesSessionPolicy')
          ]
        })
      );

      // Create an identity pool
      const publicIdentityPool = createConstruct(this, 'PUBLIC_IDENTITY_POOL_NAME', context,
        (id) => new cognito.CfnIdentityPool(this, id, {
          identityPoolName: id,
          allowUnauthenticatedIdentities: false,
          cognitoIdentityProviders: [
            {
              clientId: publicUserPoolClient.userPoolClientId,
              providerName: publicUserPool.userPoolProviderName
            }
          ],
        }),
        // Import function
        null,
        // Export function
        (construct) => exportToSSM(this, 'PUBLIC_IDENTITY_POOL_NAME', construct.ref, 'ref', context)
      );

      // Attach roles to the identity pool
      new cognito.CfnIdentityPoolRoleAttachment(this, 'PublicIdentityPoolRoleAttachment', {
        identityPoolId: publicIdentityPool.ref,
        roles: {
          authenticated: publicAuthenticatedRole.roleArn,
          unauthenticated: publicUnauthenticatedRole.roleArn
        }
      });

      // Set up UI customization for the User Pool
      new cognito.CfnUserPoolUICustomizationAttachment(this, 'PublicCognitoUICustomization', {
        userPoolId: publicUserPool.userPoolId,
        clientId: publicUserPoolClient.userPoolClientId,
        css: userPoolStyling
      });

    } catch (error) {
      logger.error(`Error creating Public Identity Stack (${id}):\n ${error}`);
    }
  }
}

async function loadCssAsString() {

}

async function createPublicIdentityStack(app, stackName, appContext) {
  try {
    logger.info(`Creating Public Identity Stack (${stackName}, ${appContext.ENVIRONMENT_NAME})`);
    // get environment configuration
    // Import env configuration
    let stackConfig = await getContextFromSSM(stackName, appContext);

    // Merge context order:
    // default stack context (default-context.json) <
    // stack config params (SSM ParameterStore or local) <
    // app context (cdk.json)
    let stackContext = { ...contextDefaults, ...stackConfig, ...appContext };
    stackContext.STACK_NAME = stackName; // ensure stack name is included in context

    return new PublicIdentityStack(app, stackNamer(stackName, stackContext), {
      context: stackContext,
      description: `Public Identity Stack for ${APP_NAME} - ${appContext.ENVIRONMENT_NAME} environment`
    });

  } catch (error) {
    logger.error(`Error creating Public Identity Stack (${stackName}, ${appContext.ENVIRONMENT_NAME}):\n ${error}`);
  }
}

module.exports = {
  createPublicIdentityStack
};