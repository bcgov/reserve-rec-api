'use strict';

const { Exception, logger, sendResponse } = require('/opt/base');
const { getQueueMeta, updateQueueMetaStatus, queryQueueEntries, updateQueueEntryStatus } = require('../utils/dynamodb');

exports.handler = async (event) => {
  logger.info('WaitingRoom admin CLOSE-QUEUE');

  try {
    const queueId = event?.pathParameters?.queueId
      ? decodeURIComponent(event.pathParameters.queueId)
      : null;

    if (!queueId) {
      throw new Exception('Missing path parameter: queueId', { code: 400 });
    }

    const meta = await getQueueMeta(queueId);
    if (!meta) {
      throw new Exception('Queue not found', { code: 404 });
    }
    if (meta.queueStatus === 'closed') {
      return sendResponse(200, { queueId, alreadyClosed: true, abandonedCount: 0 }, 'Queue already closed');
    }

    // Force-close the queue (no condition — admin override regardless of current status)
    await updateQueueMetaStatus(queueId, 'closed');

    // Abandon all active entries
    const activeEntries = await queryQueueEntries(queueId, { statuses: ['waiting', 'admitting'] });
    const now = Math.floor(Date.now() / 1000);
    let abandonedCount = 0;

    for (const entry of activeEntries) {
      await updateQueueEntryStatus(entry.pk, entry.cognitoSub, 'abandoned', null, { abandonedAt: now });
      abandonedCount++;
    }

    // Disconnect active WebSocket connections so users see immediate feedback
    // instead of a stale waiting room UI.
    const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
    if (endpoint && activeEntries.length > 0) {
      const { ApiGatewayManagementApiClient, DeleteConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
      const wsClient = new ApiGatewayManagementApiClient({ endpoint });
      for (const entry of activeEntries) {
        if (entry.connectionId) {
          try {
            await wsClient.send(new DeleteConnectionCommand({ ConnectionId: entry.connectionId }));
          } catch (err) {
            logger.debug(`Could not delete connection ${entry.connectionId}: ${err.message}`);
          }
        }
      }
    }

    logger.info(`Force-closed queue ${queueId}, abandoned ${abandonedCount} entries`);

    return sendResponse(200, { queueId, closedAt: now, abandonedCount }, 'Queue closed');

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom CLOSE-QUEUE error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
