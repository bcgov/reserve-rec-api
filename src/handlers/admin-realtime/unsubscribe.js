'use strict';

const { logger } = require('/opt/base');
const { topicKey, deleteRow, reply, readTopic } = require('./store');

/**
 * unsubscribe: leave a topic. Leaving a topic never joined still succeeds.
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const { topic, error } = readTopic(event);
  if (error) return reply({ type: 'error', code: error });

  try {
    await deleteRow(topicKey(topic, connectionId));
    return reply({ type: 'unsubscribed', topic });
  } catch (err) {
    logger.error('Admin realtime unsubscribe failed', { connectionId, topic, error: err.message });
    return { statusCode: 500 };
  }
};
