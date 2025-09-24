const { CognitoIdentityProviderClient, ListUsersCommand, DescribeUserPoolCommand, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { Exception } = require('/opt/base');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const options = {
};

const LIST_USER_FILTER_KEYS = [
  'username',
  'sub',
  'email',
  'phone_number',
  'name',
  'given_name',
  'family_name',
  'preferred_username',
  'cognito:user_status',
  'status'
];

const cognitoProviderClient = new CognitoIdentityProviderClient(options);

async function describeUserPool(userPoolId) {
  const command = {
    UserPoolId: userPoolId
  };
  try {
    const response = await cognitoProviderClient.send(new DescribeUserPoolCommand(command));
  } catch (error) {
    throw new Exception(`Failed to describe user pool: ${error}`);
  }
}

async function listUsers(userPoolId, limit, paginationToken, filter = null) {
  const command = {
    UserPoolId: userPoolId,
    Limit: limit,
    PaginationToken: paginationToken
  };
  if (filter) {
    command['Filter'] = filter;
  }
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
  LIST_USER_FILTER_KEYS,
  cognitoProviderClient,
  adminGetUser,
  describeUserPool,
  listUsers
};