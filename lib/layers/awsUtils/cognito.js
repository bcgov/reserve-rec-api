const { CognitoIdentityProviderClient, ListUsersCommand, DescribeUserPoolCommand, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { Exception } = require('/opt/base');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const options = {
};

const cognitoProviderClient = new CognitoIdentityProviderClient(options);

async function describeUserPool(userPoolId) {
  const command = {
    UserPoolId: userPoolId
  };
  try {
    const response = await cognitoProviderClient.send(new DescribeUserPoolCommand(command));
  } catch(error) {
    throw new Exception(`Failed to describe user pool: ${error}`);
  }
}

async function listUsers(userPoolId, limit, paginationToken) {
  const command = {
    UserPoolId: userPoolId,
    Limit: limit,
    PaginationToken: paginationToken
  };
  try {
    const response = await cognitoProviderClient.send(new ListUsersCommand(command));
    return response.Users;
  } catch (error) {
    throw new Exception(`Failed to list users: ${error}`);
  }
}

async function adminGetUser(userPoolId, username) {
  const command = {
    UserPoolId: userPoolId,
    Username: username
  };
  try {
    const response = await cognitoProviderClient.send(new AdminGetUserCommand(command));
    return response;
  } catch (error) {
    throw new Exception(`Failed to get user: ${error}`);
  }
}

module.exports = {
  cognitoProviderClient,
  adminGetUser,
  describeUserPool,
  listUsers
};