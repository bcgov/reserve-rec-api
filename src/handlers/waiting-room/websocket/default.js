'use strict';

const { logger, redactEvent } = require('/opt/base');

/**
 * WebSocket $default route handler.
 * Handles all unmatched messages (including client-side ping/heartbeat frames).
 * Simply acknowledges the message to keep the connection alive.
 */
exports.handler = async (event) => {
  logger.debug('WebSocket $default:', JSON.stringify(redactEvent(event)));
  return { statusCode: 200 };
};
