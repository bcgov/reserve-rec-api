'use strict';

const { Exception, logger, sendResponse } = require('/opt/base');
const { getQueueMeta, queryQueueEntries } = require('../utils/dynamodb');

exports.handler = async (event) => {
  logger.info('WaitingRoom admin QUEUE-METRICS');

  try {
    const queueId = event?.pathParameters?.queueId
      ? decodeURIComponent(event.pathParameters.queueId)
      : null;

    if (!queueId) {
      throw new Exception('Missing path parameter: queueId', { code: 400 });
    }

    const [meta, entries] = await Promise.all([
      getQueueMeta(queueId),
      queryQueueEntries(queueId),
    ]);

    if (!meta) {
      throw new Exception('Queue not found', { code: 404 });
    }

    const counts = { waiting: 0, admitting: 0, admitted: 0, expired: 0, abandoned: 0 };
    for (const entry of entries) {
      if (counts[entry.status] !== undefined) counts[entry.status]++;
    }

    return sendResponse(200, {
      queueId,
      queueStatus: meta.queueStatus,
      openingTime: meta.openingTime,
      totalEntries: meta.totalEntries || 0,
      admittedCount: meta.admittedCount || 0,
      updatedAt: meta.updatedAt,
      counts,
    }, 'Success');

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom QUEUE-METRICS error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
