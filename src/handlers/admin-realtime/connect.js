'use strict';

const { logger } = require('/opt/base');
const { metaKey, expiresAt, putRow } = require('./store');

/**
 * $connect: record the connection with the permissions and token expiry the
 * authorizer resolved.
 */
exports.handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  const { userId, permissions, isSuperAdmin, exp } = event.requestContext?.authorizer || {};
  const tokenExp = Number(exp);
  if (!connectionId || !userId || !permissions || !Number.isFinite(tokenExp)) {
    logger.error('Admin realtime connect: missing connectionId or authorizer context', { connectionId, userId });
    return { statusCode: 400 };
  }

  try {
    await putRow({
      ...metaKey(connectionId),
      userId,
      permissions: JSON.parse(permissions),
      exp: tokenExp,
      connectedAt: Date.now(),
      ttl: expiresAt(),
    });
    logger.info('event=realtime_connected', { connectionId, userId, isSuperAdmin });
    return { statusCode: 200 };
  } catch (err) {
    logger.error('Admin realtime connect failed', { connectionId, userId, error: err.message });
    return { statusCode: 500 };
  }
};
