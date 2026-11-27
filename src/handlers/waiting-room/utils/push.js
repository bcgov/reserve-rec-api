'use strict';

const { logger } = require('/opt/base');

const PUSH_CHUNK = 100;

/**
 * Returns a poster that sends a JSON payload to a WebSocket connection over one shared client.
 * Resolves 'sent', 'stale' (410 GoneException) or 'failed'; never throws.
 */
function createConnectionPoster() {
  const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
  let client;

  return async (connectionId, payload) => {
    if (!connectionId || !endpoint) {
      logger.warn('postToConnection: missing connectionId or endpoint');
      return 'failed';
    }

    try {
      const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
      client ??= new ApiGatewayManagementApiClient({ endpoint });
      await client.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      }));
      return 'sent';
    } catch (err) {
      if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) {
        logger.info(`Stale WebSocket connection: ${connectionId}`);
        return 'stale';
      }
      logger.warn(`Failed to push to WebSocket ${connectionId}:`, err.message);
      return 'failed';
    }
  };
}

/**
 * Tells each still-waiting user their 1-based place in line; per-push failures are only counted.
 */
async function pushPositions(postToConnection, remaining) {
  const startedAt = Date.now();
  const counts = { sent: 0, stale: 0, failed: 0 };
  const targets = remaining
    .map((entry, idx) => ({ connectionId: entry.connectionId, position: idx + 1 }))
    .filter(t => t.connectionId);

  for (let i = 0; i < targets.length; i += PUSH_CHUNK) {
    const results = await Promise.allSettled(
      targets.slice(i, i + PUSH_CHUNK).map(t =>
        postToConnection(t.connectionId, { type: 'position', position: t.position, total: remaining.length })
      )
    );
    for (const r of results) counts[r.status === 'fulfilled' ? r.value : 'failed']++;
  }
  logger.info(`Mode2 positions: sent ${counts.sent}, stale ${counts.stale}, failed ${counts.failed} in ${Date.now() - startedAt}ms`);
}

module.exports = { createConnectionPoster, pushPositions };
