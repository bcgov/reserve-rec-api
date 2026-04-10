const { adminGetUser } = require("/opt/cognito");
const { logger } = require("/opt/base");
const { getOne } = require("/opt/dynamodb");

async function getUserInfoByUserName(userName, userPoolId = 'public') {
  // This function retrieves user information from the Cognito user pool based on the user's userName
  try {

      if (userPoolId === 'admin' || userPoolId === 'public') {
        // Shortform to get the appropriate user pool ID from config variables
        // Instead of passing the full user pool ID, clients can pass 'admin' or 'public'
        const config = await getOne('config', userPoolId);
        if (userPoolId === 'admin' && config && config?.ADMIN_USER_POOL_ID) {
          userPoolId = config.ADMIN_USER_POOL_ID;
        } else if (userPoolId === 'public' && config && config?.PUBLIC_USER_POOL_ID) {
          userPoolId = config.PUBLIC_USER_POOL_ID;
        }
      }

    const user = await adminGetUser(userPoolId, userName);

    return user;
  } catch (error) {
    logger.error('Error fetching user info from Cognito:', error);
    throw new Error('Error fetching user info');
  }
}

async function getUsersByUserPoolId(userPoolId, props = {}) {
  // This function retrieves a list of users from the specified Cognito user pool
  try {
    const users = await listUsers(userPoolId, 60);
    return users;
  } catch (error) {
    logger.error('Error fetching users from Cognito', error);
    throw new Error('Error fetching users');
  }
}

module.exports = {
  getUserInfoByUserName,
  getUsersByUserPoolId
}