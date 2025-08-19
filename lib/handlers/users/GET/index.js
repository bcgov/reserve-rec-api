const { sendResponse, logger, Exception } = require('/opt/base');
const { listUsers, adminGetUser } = require('/opt/cognito');

const MAX_LIST_LIMIT = 60;

exports.handler = async function (event, context) {
  logger.debug('User GET', JSON.stringify(event));

  const userPoolId = event?.pathParameters?.userPoolId || null;

  if (!userPoolId) {
    return sendResponse(400, {}, 'User pool ID is required', null, context);
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
      const userList = await listUsers(userPoolId, limit, paginationToken);
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