'use strict';

const { logger } = require('/opt/base');
const {
  setDisconnectedAt,
  getConnectionRecord,
  deleteConnectionRecord,
} = require('../utils/dynamodb');

/**
 * WebSocket $disconnect handler.
 *
 * Records disconnectedAt on the queue entry.
 * Does NOT immediately mark the entry as abandoned — the Cleanup Lambda
 * applies the grace period check (disconnectedAt + disconnectGracePeriodSeconds < now).
 *
 * Uses the connection record (written by $connect) to map connectionId → (queueId, cognitoSub).
 */
exports.handler = async (event) => {
  logger.debug('WebSocket $disconnect:', JSON.stringify(event));

  const connectionId = event.requestContext?.connectionId;
  if (!connectionId) {
    logger.warn('Disconnect: no connectionId in event');
    return { statusCode: 200 };
  }

  try {
    const conn = await getConnectionRecord(connectionId);
    if (!conn) {
      logger.info(`Disconnect: no connection record for ${connectionId} (already cleaned up)`);
      return { statusCode: 200 };
    }

    const { queueId, cognitoSub } = conn;

    // Record disconnect time — Cleanup Lambda will handle grace period
    await setDisconnectedAt(queueId, cognitoSub);

    // Remove the connection record
    await deleteConnectionRecord(connectionId);

    logger.info(`WebSocket disconnected: ${connectionId} (${cognitoSub} in ${queueId})`);
    return { statusCode: 200 };

  } catch (err) {
    logger.error('WebSocket $disconnect error:', { connectionId, error: err.message });
    return { statusCode: 500 };
  }
};
