const cdk = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');

function cognitoSetup(scope) {
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
}

module.exports = {
  cognitoSetup
};