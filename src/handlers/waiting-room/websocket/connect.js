'use strict';

const { logger } = require('/opt/base');
const {
  getQueueEntry,
  setConnectionId,
  putConnectionRecord,
} = require('../utils/dynamodb');

const ACTIVE_STATUSES = ['waiting', 'admitting', 'admitted'];

/**
 * WebSocket $connect handler.
 *
 * Called after the Lambda authorizer approves the connection.
 * The authorizer context provides cognitoSub and queueId.
 *
 * Responsibilities:
 * 1. Verify user has an active entry in the queue
 * 2. If a different connectionId is already stored on the entry, disconnect it
 * 3. Store the new connectionId on the queue entry
 * 4. Write a connection record (CONN#<connectionId>) for disconnect lookup
 */
exports.handler = async (event) => {
  logger.debug('WebSocket $connect:', JSON.stringify(event));

  const connectionId = event.requestContext?.connectionId;
  const cognitoSub = event.requestContext?.authorizer?.cognitoSub;
  const queueId = event.requestContext?.authorizer?.queueId;

  if (!connectionId || !cognitoSub || !queueId) {
    logger.error('Connect: missing connectionId, cognitoSub, or queueId', { connectionId, cognitoSub, queueId });
    return { statusCode: 400 };
  }

  try {
    // Verify active queue entry exists
    const entry = await getQueueEntry(queueId, cognitoSub);
    if (!entry) {
      logger.info(`Connect: no entry for ${cognitoSub} in queue ${queueId}`);
      return { statusCode: 403 };
    }
    if (!ACTIVE_STATUSES.includes(entry.status)) {
      logger.info(`Connect: entry status '${entry.status}' is not active for ${cognitoSub}`);
      return { statusCode: 403 };
    }

    // Disconnect previous connection if a different one exists
    if (entry.connectionId && entry.connectionId !== connectionId) {
      const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
      if (endpoint) {
        try {
          const { ApiGatewayManagementApiClient, DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
          const wsClient = new ApiGatewayManagementApiClient({ endpoint });
          await wsClient.send(new DeleteConnectionCommand({ ConnectionId: entry.connectionId }));
          logger.info(`Disconnected previous connection ${entry.connectionId} for ${cognitoSub}`);
        } catch (err) {
          // Ignore GoneException — old connection is already gone
          logger.debug(`Could not delete previous connection ${entry.connectionId}:`, err.message);
        }
      }
    }

    // Write connection record first (idempotent by connectionId PK; an orphan from a crash
    // here is cleaned up by TTL in 1h — benign). Then update the queue entry.
    await putConnectionRecord(connectionId, queueId, cognitoSub);

    // Store new connectionId on the entry (clears disconnectedAt if present)
    await setConnectionId(queueId, cognitoSub, connectionId);

    // If user is already admitted, re-push the admitted notification so they
    // can call /claim even if they missed the original push (e.g. reconnect after disconnect)
    if (entry.status === 'admitted') {
      const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
      if (endpoint) {
        try {
          const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
          const wsClient = new ApiGatewayManagementApiClient({ endpoint });
          await wsClient.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify({ type: 'admitted' })),
          }));
          logger.info(`Re-pushed admitted notification to reconnected client ${connectionId}`);
        } catch (err) {
          logger.warn(`Could not re-push admitted notification to ${connectionId}:`, err.message);
        }
      }
    }

    logger.info(`WebSocket connected: ${connectionId} → ${cognitoSub} in ${queueId}`);
    return { statusCode: 200 };

  } catch (err) {
    logger.error('WebSocket $connect error:', { connectionId, cognitoSub, queueId, error: err.message });
    return { statusCode: 500 };
  }
};
