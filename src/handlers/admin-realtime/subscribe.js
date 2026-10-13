'use strict';

const { logger } = require('/opt/base');
const { canSubscribe } = require('./topics');
const { getOne } = require('/opt/dynamodb');
const { tableName, metaKey, topicKey, expiresAt, isExpired, putRow, reply, readTopic } = require('./store');

/**
 * subscribe: join a topic if the connection's permissions allow it.
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const { topic, error } = readTopic(event);
  if (error) return reply({ type: 'error', code: error });

  try {
    const { pk, sk } = metaKey(connectionId);
    const meta = await getOne(pk, sk, tableName());
    if (!meta || isExpired(meta) || !canSubscribe(topic, meta.permissions)) {
      logger.info('event=realtime_subscribe_forbidden', { connectionId, userId: meta?.userId, topic });
      return reply({ type: 'error', code: 'forbidden' });
    }
    await putRow({ ...topicKey(topic, connectionId), connectionId, userId: meta.userId, ttl: expiresAt() });
    return reply({ type: 'subscribed', topic });
  } catch (err) {
    logger.error('Admin realtime subscribe failed', { connectionId, topic, error: err.message });
    return { statusCode: 500 };
  }
};
