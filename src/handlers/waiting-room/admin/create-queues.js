'use strict';

const { Exception, logger, sendResponse } = require('/opt/base');
const { buildQueueId, createQueueMeta } = require('../utils/dynamodb');

const TTL_BUFFER_HOURS = 48; // Queue META TTL: openingTime + 48h

exports.handler = async (event) => {
  logger.info('WaitingRoom admin CREATE-QUEUES');

  try {
    const body = JSON.parse(event?.body || '{}');
    const { collectionId, activityType, activityId, openingTimes } = body;

    if (!collectionId || !activityType || !activityId) {
      throw new Exception('Missing required fields: collectionId, activityType, activityId', { code: 400 });
    }
    if (!Array.isArray(openingTimes) || openingTimes.length === 0) {
      throw new Exception('openingTimes must be a non-empty array of { startDate, openingTime }', { code: 400 });
    }

    const created = [];
    const errors = [];

    for (const { startDate, openingTime } of openingTimes) {
      if (!startDate || !openingTime) {
        errors.push({ startDate, reason: 'Missing startDate or openingTime' });
        continue;
      }

      const openingTimeMs = new Date(openingTime).getTime();
      if (isNaN(openingTimeMs)) {
        errors.push({ startDate, reason: `Invalid openingTime: ${openingTime}` });
        continue;
      }

      const queueId = buildQueueId(collectionId, activityType, activityId, startDate);
      const now = Math.floor(Date.now() / 1000);
      const openingTimeUnix = Math.floor(openingTimeMs / 1000);
      const ttl = openingTimeUnix + TTL_BUFFER_HOURS * 3600;

      try {
        await createQueueMeta({
          pk: queueId,
          sk: 'META',
          queueStatus: 'pre-open',
          collectionId,
          activityType,
          activityId,
          startDate,
          openingTime,
          totalEntries: 0,
          admittedCount: 0,
          createdAt: now,
          updatedAt: now,
          ttl,
        });

        created.push({ queueId, startDate, openingTime });
        logger.info(`Created queue: ${queueId}`);
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
          errors.push({ startDate, reason: 'Queue already exists for this date' });
        } else {
          errors.push({ startDate, reason: err.message });
        }
      }
    }

    const statusCode = created.length > 0 ? 200 : 400;
    return sendResponse(statusCode, { created, errors }, `Created ${created.length} queue(s)`);

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom CREATE-QUEUES error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
