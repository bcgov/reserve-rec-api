const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');

const client = new CognitoIdentityProviderClient();

exports.handler = async (event) => {
  const { userPoolId, userName } = event;

  // Only run for AdminCreateUser confirmations (not other trigger sources)
  if (event.triggerSource === 'PostConfirmation_ConfirmForgotPassword') {
    return event;
  }

  await client.send(new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: userName,
    GroupName: process.env.UNAUTHORIZED_USER_GROUP_NAME,
  }));

  return event; // Lambda triggers must return the event
};
