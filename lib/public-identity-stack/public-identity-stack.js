const { exportValue, getContextFromSSM, logger, stackNamer, createConstruct } = require('../utils');
const { Stack, RemovalPolicy, Duration } = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const contextDefaults = require('./default-context.json');

// Load CSS file for Cognito User Pool UI customization
const fs = require('fs');
const path = require('path');
const cssPath = path.join(__dirname, 'cognito-ui-styling.css');
const userPoolStyling = fs.readFileSync(cssPath, 'utf8');

class PublicIdentityStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const stackConstants = props?.CONSTANTS?.STACKS?.PUBLIC_IDENTITY_STACK;

    // Create a public Cognito User Pool
    const publicUserPoolName = stackConstants?.PUBLIC_USER_POOL_NAME;
    const publicUserPool = createConstruct(this, publicUserPoolName, {
      createFn: (id) => new cognito.UserPool(this, id, {
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
        deletionProtection: props?.POOL_DELETION_PROTECTION ? true : false,
        removalPolicy: RemovalPolicy.DESTROY
      }),
      exportFn: (construct) => exportValue(this, publicUserPoolName, {
        value: construct.userPoolId,
        pathSuffix: 'userPoolId',
        ...props
      }),
      ...props
    });

    // Set up User Pool Domain for public users
    const userPoolDomainName = stackConstants?.PUBLIC_USER_POOL_DOMAIN_NAME;
    const userPoolDomain = createConstruct(this, userPoolDomainName, {
      createFn: (id) => new cognito.UserPoolDomain(this, id, {
        userPool: publicUserPool,
        cognitoDomain: {
          domainPrefix: `${props.COGNITO_DOMAIN_PREFIX}-${props.ENVIRONMENT_NAME}`
        }
      }),
      exportFn: (construct) => exportValue(this, userPoolDomainName, {
        value: `https://${construct.domainName}-${props?.ENVIRONMENT_NAME}.auth.${props?.AWS_REGION}.amazoncognito.com`,
        pathSuffix: 'domainName',
        ...props
      }),
      ...props
    });

    // Setup Cognito User Pool Client for public users
    const publicUserPoolClientName = stackConstants?.PUBLIC_USER_POOL_CLIENT_NAME;
    const publicUserPoolClient = createConstruct(this, publicUserPoolClientName, {
      createFn: (id) => new cognito.UserPoolClient(this, id, {
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
          callbackUrls: props?.PUBLIC_COGNITO_CALLBACK_URLS,
          logoutUrls: props?.PUBLIC_COGNITO_LOGOUT_URLS,
        },
        accessTokenValidity: Duration.days(1),
        idTokenValidity: Duration.days(1),
        refreshTokenValidity: Duration.days(30),
      }),
      exportFn: (construct) => exportValue(this, publicUserPoolClientName, {
        value: construct.userPoolClientId,
        pathSuffix: 'userPoolClientId',
        ...props
      }),
      ...props
    });

    // Define the authenticated role
    const cognitoAuthenticatedRoleName = stackConstants?.COGNITO_AUTHENTICATED_ROLE_NAME;
    const cognitoAuthenticatedRole = createConstruct(this, cognitoAuthenticatedRoleName, {
      createFn: (id) => new iam.Role(this, id, {
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
      }),
      ...props
    });

    // Define the unauthenticated role
    const cognitoUnauthenticatedRoleName = stackConstants?.COGNITO_UNAUTHENTICATED_ROLE_NAME;
    const cognitoUnauthenticatedRole = createConstruct(this, cognitoUnauthenticatedRoleName, {
      createFn: (id) => new iam.Role(this, id, {
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
            clientId: publicUserPoolClient.userPoolClientId,
            providerName: publicUserPool.userPoolProviderName
          }
        ],
      }),
      exportFn: (construct) => exportValue(this, identityPoolName, {
        value: construct.ref,
        pathSuffix: 'ref',
        ...props
      }),
      ...props
    });

    // Attach roles to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'PublicIdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: cognitoAuthenticatedRole.roleArn,
        unauthenticated: cognitoUnauthenticatedRole.roleArn
      }
    });

    // Set up UI customization for the User Pool
    new cognito.CfnUserPoolUICustomizationAttachment(this, 'PublicCognitoUICustomization', {
      userPoolId: publicUserPool.userPoolId,
      clientId: publicUserPoolClient.userPoolClientId,
      css: userPoolStyling
    });
  }
}

async function createPublicIdentityStack(app, stackName, context) {
  try {
    logger.info(`Creating Public Identity Stack (${stackName}, ${context.ENVIRONMENT_NAME})`);
    // get environment configuration
    context = { ...contextDefaults, ...await getContextFromSSM(stackName, context), ...context };
    context['STACK_NAME'] = stackName; // ensure stack name is included in context

    const stack = new PublicIdentityStack(app, stackNamer(stackName, context), {
      description: `Public Identity Stack for ${context?.CONSTANTS?.APP_NAME} - ${context.ENVIRONMENT_NAME} environment`,
      ...context
    });

    logger.info(`${stackName} setup complete.\n`);
    return stack;

  } catch (error) {
    logger.error(`Error creating Public Identity Stack (${stackName}, ${context.ENVIRONMENT_NAME}):\n ${error}\n Stack may not have created properly.`);
  }
}

module.exports = {
  createPublicIdentityStack
};