const cdk = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');

function cognitoSetup(scope, accountId) {
  console.log("Setting up Cognito...");

  // Setup Cognito
  const userPool = new cognito.UserPool(scope, "UserPool", {
    userPoolName: "AdminPool",
    selfSignUpEnabled: false,
    accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    removalPolicy: cdk.RemovalPolicy.DESTROY
  });

  const oidcProvider = new cognito.UserPoolIdentityProviderOidc(scope, "OidcProvider", {
    userPool,
    clientId: "backcountry",
    issuerUrl: "https://dev.loginproxy.gov.bc.ca/auth/realms/bcparks-service-transformation",
    attributeMapping: {
      email: cognito.ProviderAttribute.other("email"),
      givenName: cognito.ProviderAttribute.other("given_name"),
      familyName: cognito.ProviderAttribute.other("family_name")
    }
  });

  userPool.registerIdentityProvider(oidcProvider);

  // Create an app client
  const userPoolClient = new cognito.UserPoolClient(scope, "AdminPoolClient", {
    userPool,
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
      scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
      callbackUrls: ["http://localhost:4200/callback"],
      logoutUrls: ["http://localhost:4200/logout"],
    },
    allowedOAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_CUSTOM_AUTH"],
    enableTokenRevocation: true
  });

  // Create an identity pool
  const identityPool = new cognito.CfnIdentityPool(scope, "AdminIdentityPool", {
    allowUnauthenticatedIdentities: false,
    cognitoIdentityProviders: [
      {
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName
      }
    ]
  });

  // Define the authenticated role
  const authenticatedRole = new iam.Role(scope, 'CognitoAuthenticatedRole', {
    assumedBy: new iam.FederatedPrincipal(
      'cognito-identity.amazonaws.com',
      {
        'StringEquals': { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
      },
      'sts:AssumeRoleWithWebIdentity'
    ),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoPowerUser')
    ]
  });
  
  // Define the unauthenticated role
  const unauthenticatedRole = new iam.Role(scope, 'CognitoUnauthenticatedRole', {
    assumedBy: new iam.FederatedPrincipal(
      'cognito-identity.amazonaws.com',
      {
        'StringEquals': { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
      },
      'sts:AssumeRoleWithWebIdentity'
    ),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
    ]
  });

  // Attach roles to the identity pool
  new cognito.CfnIdentityPoolRoleAttachment(scope, "IdentityPoolRoleAttachment", {
    identityPoolId: identityPool.ref,
    roles: {
      authenticated: `arn:aws:iam::${accountId}:role/Cognito_Authenticated_Role`,
      unauthenticated: `arn:aws:iam::${accountId}:role/Cognito_Unauthenticated_Role`
    }
  });
}

module.exports = {
  cognitoSetup
};