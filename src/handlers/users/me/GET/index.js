const { sendResponse, logger } = require('/opt/base');


// GET /users/me
// Returns the calling user's sub and permissions object
exports.handler = async function (event, context) {
  logger.debug('User GET /me', JSON.stringify(event));

  // When running locally with SAM, authorizer context is not injected
  const authorizer = event?.requestContext?.authorizer || {};
  const sub = process.env.AWS_SAM_LOCAL === 'true' ? 'local-dev' : (authorizer?.principalId || null);
  let permissions = {};

  try {
    permissions = process.env.AWS_SAM_LOCAL === 'true'
      ? { superadmin: 'superadmin' }
      : JSON.parse(authorizer?.permissions || '{}');
  } catch (e) {
    logger.warn('Could not parse permissions from authorizer context');
  }

  return sendResponse(200, { sub, permissions }, 'User retrieved successfully', null, context);
};
