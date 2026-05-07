'use strict';

const { Exception, logger, sendResponse } = require('/opt/base');
const { buildQueueId, createQueueMeta, getQueueMeta, putQueueMeta } = require('../utils/dynamodb');

const TTL_BUFFER_HOURS = 48; // Queue META TTL: openingTime + 48h

// Statuses where overwriting an existing queue's META is safe.
// 'pre-open' = not yet opened; 'closed' = lifecycle complete.
// Any other status (randomizing, releasing) means an active queue with
// admitted/in-flight users — refuse to overwrite.
const SAFE_TO_OVERWRITE_STATUSES = ['pre-open', 'closed'];

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

      const meta = {
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
      };

      try {
        await createQueueMeta(meta);
        created.push({ queueId, startDate, openingTime });
        logger.info(`Created queue: ${queueId}`);
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') {
          errors.push({ startDate, reason: err.message });
          continue;
        }

        // Queue already exists — overwrite if it's in a safe state with no entries.
        const existing = await getQueueMeta(queueId);
        const status = existing?.queueStatus;
        const total = existing?.totalEntries ?? 0;

        if (SAFE_TO_OVERWRITE_STATUSES.includes(status) && total === 0) {
          await putQueueMeta({ ...meta, createdAt: existing.createdAt ?? now });
          created.push({ queueId, startDate, openingTime, overwrote: true });
          logger.info(`Overwrote empty queue: ${queueId} (was '${status}')`);
        } else {
          errors.push({
            startDate,
            reason: `Queue exists with status '${status}' and ${total} entries; close+delete it before recreating`,
          });
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
