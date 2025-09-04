// Authorizer for public API access

const { logger } = require('/opt/base');
const { authorizeAll } = require('./methods');

exports.handler = async function (event, context, callback) {
  logger.debug('Public Authorizer:', JSON.stringify(event));

  // TODO: Implement the authorizer logic

  return await authorizeAll(event);
}