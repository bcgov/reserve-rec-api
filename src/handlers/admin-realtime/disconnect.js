'use strict';

const { logger } = require('/opt/base');
const { removeConnection } = require('./store');

/**
 * $disconnect: delete the connection's META and topic rows.
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  if (!connectionId) {
    logger.warn('Admin realtime disconnect: no connectionId');
    return { statusCode: 200 };
  }

  try {
    const meta = await removeConnection(connectionId);
    logger.info('event=realtime_disconnected', { connectionId, userId: meta?.userId });
    return { statusCode: 200 };
  } catch (err) {
    logger.error('Admin realtime disconnect failed', { connectionId, error: err.message });
    return { statusCode: 500 };
  }
};
