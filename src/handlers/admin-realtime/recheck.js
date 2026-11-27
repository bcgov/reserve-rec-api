'use strict';

const { logger } = require('/opt/base');
const { runScan } = require('/opt/dynamodb');
const { currentAccess } = require('./access');
const { closeConnection } = require('./publish');
const { tableName, isExpired } = require('./store');

/**
 * Runs on a timer. Looks up every open connection's user again and closes the
 * connection when their access changed since $connect, or their token expired.
 * A failed lookup leaves that connection open; the next run tries again.
 */
exports.handler = async () => {
  const { items } = await runScan({
    TableName: tableName(),
    FilterExpression: 'sk = :meta',
    ExpressionAttributeValues: { ':meta': { S: 'META' } },
  }, null, null, false);

  const counts = { checked: items.length, closed: 0, failed: 0 };
  // ponytail: one connection at a time; batch it if open connections grow into the thousands
  for (const meta of items) {
    const connectionId = meta.pk.slice('CONN#'.length);
    try {
      if (!isExpired(meta) && (await currentAccess(meta)).key === meta.accessKey) continue;
      logger.info('event=realtime_access_changed', { connectionId, userId: meta.userId });
      await closeConnection(connectionId);
      counts.closed++;
    } catch (err) {
      counts.failed++;
      logger.warn('Realtime recheck lookup failed', { connectionId, userId: meta.userId, error: err?.message });
    }
  }
  logger.info('Realtime recheck done', counts);
  return counts;
};
