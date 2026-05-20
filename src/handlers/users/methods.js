const { adminGetUser, listUsers } = require("/opt/cognito");
const { logger } = require("/opt/base");
const { getOne } = require("/opt/dynamodb");

async function resolveUserPoolId(userPoolId) {
  if (userPoolId !== 'admin' && userPoolId !== 'public') {
    return userPoolId;
  }
  const config = await getOne('config', userPoolId);
  if (userPoolId === 'admin' && config?.ADMIN_USER_POOL_ID) {
    return config.ADMIN_USER_POOL_ID;
  }
  if (userPoolId === 'public' && config?.PUBLIC_USER_POOL_ID) {
    return config.PUBLIC_USER_POOL_ID;
  }
  return userPoolId;
}

// Cognito sub is always a v4 UUID. We validate the format before interpolating
// into the ListUsers Filter string to prevent any injection into the filter
// grammar (e.g. an embedded `"` could break out of the value).
const SUB_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Look up a Cognito user by their immutable `sub` claim. Prefer this over
 * username-based lookup whenever the caller has the sub in hand — sub is the
 * stable identity, username/email can be changed by the user.
 *
 * Uses ListUsers with a sub filter so it works regardless of how the user pool
 * is configured (some pools use sub as Username, some don't).
 */
async function getUserInfoBySub(sub, userPoolId = 'public') {
  if (!sub || !SUB_PATTERN.test(sub)) {
    throw new Error('Invalid sub format');
  }
  try {
    const resolvedPoolId = await resolveUserPoolId(userPoolId);
    const users = await listUsers(resolvedPoolId, 1, undefined, `sub = "${sub}"`);
    return users?.[0] || null;
  } catch (error) {
    logger.error('Error fetching user info from Cognito by sub:', error);
    throw new Error('Error fetching user info');
  }
}

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
  getUserInfoBySub,
  getUsersByUserPoolId
}