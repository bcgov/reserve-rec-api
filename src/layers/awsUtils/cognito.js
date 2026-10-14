const { CognitoIdentityProviderClient, ListUsersCommand, DescribeUserPoolCommand, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { Exception, logger } = require('/opt/base');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

// The SDK default (3 attempts, full jitter on a ~500 ms throttle base) adds at
// most ~1.5 s; more attempts would outlast a booking request.
const options = {};

// The request was fine but Cognito could not answer it now: the caller should retry.
const TRANSIENT_ERRORS = ['TooManyRequestsException', 'ThrottlingException', 'InternalErrorException'];
const RETRY_AFTER_SECONDS = 2;

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

function cognitoError(message, error) {
  const transient = TRANSIENT_ERRORS.includes(error?.name);
  const wrapped = transient
    ? new Exception('The service is busy. Please try again in a moment.', { code: 503, data: { retryAfter: RETRY_AFTER_SECONDS } })
    : new Exception(message);
  // Non-enumerable: SDK errors can be circular, and callers JSON.stringify what they catch.
  Object.defineProperty(wrapped, 'cause', { value: error });
  return wrapped;
}

async function describeUserPool(userPoolId) {
  const command = {
    UserPoolId: userPoolId
  };
  try {
    const response = await cognitoProviderClient.send(new DescribeUserPoolCommand(command));
  } catch (error) {
    logger.error(`Failed to describe user pool: ${error}`);
    throw new Exception("Failed to describe user pool");
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
    logger.error(`Failed to list users: ${error}`);
    throw cognitoError("Failed to list users", error);
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
    logger.error(`Failed to get user: ${error}`);
    throw cognitoError("Failed to get user", error);
  }
}

module.exports = {
  LIST_USER_FILTER_KEYS,
  cognitoProviderClient,
  adminGetUser,
  describeUserPool,
  listUsers
};