const cdk = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');

function cognitoAdminSetup(scope, props) {
  console.log("Setting up Cognito...");

  // Setup Cognito
  const userPool = new cognito.UserPool(scope, "UserPool", {
    userPoolName: "AdminPool",
    selfSignUpEnabled: false,
    accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    removalPolicy: cdk.RemovalPolicy.DESTROY
  });

  // AzureIDIR
  const oidcProvider = new cognito.UserPoolIdentityProviderOidc(scope, props.env.azureProviderName, {
    userPool,
    clientId: props.env.azureClientId,
    clientSecret: props.env.azureClientSecret,
    attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
    issuerUrl: props.env.azureIssuerUrl,
    attributeMapping: {
      email: cognito.ProviderAttribute.other("email"),
      username: cognito.ProviderAttribute.other("sub")
    }
  });
  userPool.registerIdentityProvider(oidcProvider);

  // BCSC
  const bcscOIDCProvider = new cognito.UserPoolIdentityProviderOidc(scope, props.env.bcscProviderName, {
    userPool,
    clientId: props.env.bcscClientId,
    clientSecret: props.env.bcscClientSecret,
    attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
    issuerUrl: props.env.bcscIssuer,
    attributeMapping: {
      sub: cognito.ProviderAttribute.other("sub"),
      email: cognito.ProviderAttribute.other("email"),
      display_name: cognito.ProviderAttribute.other("display_name"),
      given_name: cognito.ProviderAttribute.other("given_name"),
      family_name: cognito.ProviderAttribute.other("family_name")
    }
  });
  userPool.registerIdentityProvider(bcscOIDCProvider);

  // Create an app client
  const userPoolClient = new cognito.UserPoolClient(scope, props.env.azureAppClientName, {
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
      callbackUrls: [props.env.azureCallbackUrls],
      logoutUrls: [props.env.azureLogoutUrls]
    },
    allowedOAuthFlows: [props.env.allowedOAuthFlows],
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

  // Create a Cognito domain
  const userPoolDomain = new cognito.UserPoolDomain(scope, 'AdminUserPoolDomain', {
    cognitoDomain: {
      domainPrefix: `${props.env.project}-admin-${props.env.environmentName}`
    },
    userPool: userPool
  });

  // Create the Cognito_Authenticated_Role IAM role
  const cognitoAuthenticatedRole = new iam.Role(scope, 'Cognito_Authenticated_Role', {
    assumedBy: new iam.FederatedPrincipal(
      'cognito-identity.amazonaws.com',
      {
        'StringEquals': { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
        'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
      },
      'sts:AssumeRoleWithWebIdentity'
    ),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
    ]
  });

  // Create the Cognito_Unauthenticated_Role IAM role
  const cognitoUnauthenticatedRole = new iam.Role(scope, 'Cognito_Unauthenticated_Role', {
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
      authenticated: cognitoAuthenticatedRole.roleArn,
      unauthenticated: cognitoUnauthenticatedRole.roleArn
    }
  });

  // Create a Cognito user group
  const adminGroup = new cognito.CfnUserPoolGroup(scope, 'AdminGroup', {
    userPoolId: userPool.userPoolId,
    groupName: 'Admins',
    description: 'Group for admin users',
    precedence: 1
  });

  // Create a Cognito user group for Park Operators
  const parkOperatorsGroup = new cognito.CfnUserPoolGroup(scope, 'ParkOperatorsGroup', {
    userPoolId: userPool.userPoolId,
    groupName: 'ParkOperators',
    description: 'Group for park operator users',
    precedence: 2
  });

  // Outputs
  new cdk.CfnOutput(scope, 'AdminUserPoolId', {
    value: userPool.userPoolId,
    description: 'Admin User Pool Id Reference',
    exportName: 'AdminUserPoolId',
  });

  new cdk.CfnOutput(scope, 'AdminUserPoolClientId', {
    value: userPoolClient.userPoolClientId,
    description: 'Admin User Pool Client Id Reference',
    exportName: 'AdminUserPoolClientId',
  });

  new cdk.CfnOutput(scope, 'AdminIdentityPoolId', {
    value: identityPool.ref,
    description: 'Admin Identity Pool Id Reference',
    exportName: 'AdminIdentityPoolId',
  });

  new cdk.CfnOutput(scope, 'AdminUserPoolDomainUrl', {
    value: `https://${userPoolDomain.domainName}.auth.${props.env.region}.amazoncognito.com`,
    description: 'Admin User Pool Domain Reference',
    exportName: 'AdminUserPoolDomainUrl',
  });

}

module.exports = {
  cognitoAdminSetup
};