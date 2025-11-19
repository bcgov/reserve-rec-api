const { sendResponse, logger, Exception } = require('/opt/base');
const { LIST_USER_FILTER_KEYS, listUsers, adminGetUser } = require('/opt/cognito');
const { getOne } = require('/opt/dynamodb');

const MAX_LIST_LIMIT = 60;

exports.handler = async function (event, context) {
  logger.debug('User GET', JSON.stringify(event));

  let userPoolId = event?.pathParameters?.userPoolId || null;
  let filter = null;
  if (event?.queryStringParameters && Object.keys(event?.queryStringParameters)?.length > 0) {
    for (const key of LIST_USER_FILTER_KEYS) {
      if (event.queryStringParameters[key]) {
        // Cognito API can only filter by one key at a time. Other keys will be ignored.
        // Use 'starts with' operator for string filters to get more hits.
        // This can be improved later and will probably be replaced with a more complex filtering mechanism.
        filter = `${key} ^= "${event.queryStringParameters[key]}"`;
      }
    }
  }

  if (!userPoolId) {
    return sendResponse(400, {}, 'User pool ID is required', null, context);
  }

  if (userPoolId === 'admin' || userPoolId === 'public') {
    // Shortform to get the approriate user pool ID from config variables
    // Instead of passing the full user pool ID, clients can pass 'admin' or 'public'
    const config = await getOne('config', userPoolId);
    if (config && (config?.ADMIN_USER_POOL_ID)) {
      userPoolId = config?.ADMIN_USER_POOL_ID;
    }
    if (config && (config?.PUBLIC_USER_POOL_ID)) {
      userPoolId = config?.PUBLIC_USER_POOL_ID;
    }
  }

  try {

    const sub = event?.pathParameters?.sub || event?.queryStringParameters?.sub || null;

    if (!sub) {
      // Return a list of users
      let limit = event?.queryStringParameters?.limit || 10;
      limit = parseInt(limit, 10);
      if (isNaN(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
        limit = 10;
      }
      const paginationToken = event?.queryStringParameters?.paginationToken || null;
      const userList = await listUsers(userPoolId, limit, paginationToken, filter);
      return sendResponse(200, userList, 'User list retrieved successfully', null, context);
    } else {
      // Return a specific user
      const user = await adminGetUser(userPoolId, sub);
      return sendResponse(200, user, 'User retrieved successfully', null, context);
    }

  } catch (error) {
    logger.error(JSON.stringify(error));
    return sendResponse(error?.code || 400, {}, error?.msg || 'Error', error?.error || error, context);
  }
};