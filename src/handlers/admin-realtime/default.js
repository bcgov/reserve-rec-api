'use strict';

const { logger } = require('/opt/base');
const { reply } = require('./store');

/**
 * $default: any message whose action matches no route.
 */
exports.handler = async (event) => {
  logger.debug('Admin realtime $default', { bodyLength: event.body?.length ?? 0 });
  return reply({ type: 'error', code: 'bad_request' });
};
