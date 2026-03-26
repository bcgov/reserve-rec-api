const { sendResponse, logger } = require('/opt/base');


// GET /users/me
// Returns the calling user's sub and permissions object
exports.handler = async function (event, context) {
  logger.debug('User GET /me', JSON.stringify(event));

  const authorizer = event?.requestContext?.authorizer;
  const sub = authorizer?.principalId || null;
  let permissions = {};

  try {
    permissions = JSON.parse(authorizer?.permissions || '{}');
  } catch (e) {
    logger.warn('Could not parse permissions from authorizer context');
  }

  return sendResponse(200, { sub, permissions }, 'User retrieved successfully', null, context);
};
