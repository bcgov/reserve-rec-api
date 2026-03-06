'use strict';

const { logger, sendResponse } = require('/opt/base');
const { scanQueuesByStatus, scanAllQueueMetas } = require('../utils/dynamodb');

const VALID_STATUSES = ['pre-open', 'randomizing', 'releasing', 'closed'];

exports.handler = async (event) => {
  logger.info('WaitingRoom admin LIST-QUEUES');

  try {
    const status = event?.queryStringParameters?.status || null;

    if (status && !VALID_STATUSES.includes(status)) {
      return sendResponse(400, null, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const queues = status
      ? await scanQueuesByStatus(status)
      : await scanAllQueueMetas();

    // Strip internal pk/sk, return clean shape
    const result = queues.map(q => ({
      queueId: q.pk,
      queueStatus: q.queueStatus,
      openingTime: q.openingTime,
      totalEntries: q.totalEntries || 0,
      admittedCount: q.admittedCount || 0,
      abandonedCount: q.abandonedCount || 0,
      updatedAt: q.updatedAt,
      // Mode 2 fields
      ...(q.batchSize != null && { batchSize: q.batchSize }),
      ...(q.releaseIntervalSeconds != null && { releaseIntervalSeconds: q.releaseIntervalSeconds }),
      ...(q.releaseMode != null && { releaseMode: q.releaseMode }),
      ...(q.lastReleasedAt != null && { lastReleasedAt: q.lastReleasedAt }),
    }));

    return sendResponse(200, { queues: result, count: result.length }, 'Success');

  } catch (err) {
    logger.error('WaitingRoom LIST-QUEUES error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
