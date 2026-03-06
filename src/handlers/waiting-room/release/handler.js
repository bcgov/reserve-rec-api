'use strict';

const { logger } = require('/opt/base');
const {
  getQueueMeta,
  updateQueueMetaStatus,
  updateQueueMetaLastReleasedAt,
  queryQueueEntries,
  setEntryAdmitting,
  setEntryAdmitted,
  updateQueueEntryStatus,
  incrementAdmittedCount,
  decrementAdmittedCount,
} = require('../utils/dynamodb');
const { generateToken } = require('../utils/token');
const { getHmacSigningKey } = require('../utils/secrets');

const MAX_ACTIVE_SESSIONS = parseInt(process.env.MAX_ACTIVE_SESSIONS || '100', 10);
const RELEASE_BATCH_SIZE = parseInt(process.env.RELEASE_BATCH_SIZE || '50', 10);
const ADMISSION_TTL_MINUTES = parseInt(process.env.ADMISSION_TTL_MINUTES || '15', 10);

/**
 * Push an admission notification to a connected WebSocket client.
 * Returns true on success, false on stale connection (410 GoneException).
 */
async function pushAdmissionNotification(connectionId) {
  const WEBSOCKET_MANAGEMENT_ENDPOINT = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
  if (!connectionId || !WEBSOCKET_MANAGEMENT_ENDPOINT) {
    logger.warn('pushAdmissionNotification: missing connectionId or endpoint');
    return false;
  }

  try {
    const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
    const wsClient = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_MANAGEMENT_ENDPOINT });
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify({ type: 'admitted' })),
    }));
    return true;
  } catch (err) {
    if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) {
      logger.info(`Stale WebSocket connection: ${connectionId}`);
      return false;
    }
    logger.warn(`Failed to push to WebSocket ${connectionId}:`, err.message);
    return false;
  }
}

/**
 * Handle Mode 2 (full-site gating) release.
 * FIFO ordering (by joinedAt), no active-session ceiling, time-gated.
 */
async function handleMode2Release(queueId, queueMeta, force = false) {
  const now = Math.floor(Date.now() / 1000);
  const releaseIntervalSeconds = queueMeta.releaseIntervalSeconds || 300;
  const lastReleasedAt = queueMeta.lastReleasedAt || 0;

  // Time gate — only release when interval has elapsed (bypassed when force=true for admin releases)
  if (!force && now - lastReleasedAt < releaseIntervalSeconds) {
    const nextRelease = lastReleasedAt + releaseIntervalSeconds;
    logger.info(`Mode2 queue ${queueId}: next release in ${nextRelease - now}s`);
    return { status: 'too-soon', nextRelease };
  }

  const waitingEntries = await queryQueueEntries(queueId, { statuses: ['waiting'] });
  if (waitingEntries.length === 0) {
    logger.info(`Mode2 queue ${queueId}: no waiting entries`);
    return { status: 'empty', queueId };
  }

  // FIFO: sort by joinedAt ascending
  waitingEntries.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));

  const batchSize = Math.min(queueMeta.batchSize || 50, waitingEntries.length);
  const batch = waitingEntries.slice(0, batchSize);

  logger.info(`Mode2 queue ${queueId}: admitting batch of ${batchSize} (${waitingEntries.length} waiting)`);

  const hmacKey = await getHmacSigningKey();
  const facilityKey = queueMeta.facilityKey || 'MODE2#global#1';
  let successCount = 0;
  let failCount = 0;

  for (const entry of batch) {
    const cognitoSub = entry.cognitoSub;
    const admissionExpiry = now + ADMISSION_TTL_MINUTES * 60;

    const token = generateToken(cognitoSub, facilityKey, '', hmacKey, ADMISSION_TTL_MINUTES);

    const set = await setEntryAdmitting(queueId, cognitoSub, token, admissionExpiry);
    if (!set) {
      logger.warn(`Mode2: could not set admitting for ${cognitoSub} (status changed)`);
      failCount++;
      continue;
    }

    const pushed = await pushAdmissionNotification(entry.connectionId);
    // Always mark admitted — if WS push failed the user has no active connection,
    // but they will be admitted on their next page load: the join handler returns
    // status='admitted' which triggers handleAdmission() → claim → redirect.
    await setEntryAdmitted(queueId, cognitoSub);
    successCount++;
    if (!pushed) {
      logger.info(`Mode2: admitted ${cognitoSub} without WS push (will claim on next page load)`);
    }
  }

  // Update lastReleasedAt and admittedCount for admin UI stats
  await updateQueueMetaLastReleasedAt(queueId, now, successCount);

  logger.info(`Mode2 queue ${queueId}: released ${successCount} (${failCount} no-WS-connection)`);
  return { status: 'released', queueId, admitted: successCount, reverted: failCount };
}

/**
 * Release Lambda handler.
 * Invoked by Queue Monitor Lambda for each queue in 'releasing' state.
 *
 * Expected event: { queueId: "QUEUE#..." }
 */
exports.handler = async (event, context) => {
  const queueId = event?.queueId;
  logger.info('WaitingRoom RELEASE:', { queueId });

  if (!queueId) {
    logger.error('Release called without queueId');
    return { status: 'error', message: 'Missing queueId' };
  }

  try {
    const force = event?.force === true;
    const queueMeta = await getQueueMeta(queueId);
    if (!queueMeta) {
      logger.warn(`Release: queue ${queueId} not found`);
      return { status: 'error', message: 'Queue not found' };
    }
    if (queueMeta.queueStatus !== 'releasing') {
      logger.info(`Release: queue ${queueId} not in releasing state (${queueMeta.queueStatus})`);
      return { status: 'skipped', reason: 'not-releasing' };
    }

    // ── MODE2 path: FIFO, no ceiling, time-gated ──────────────────────────────
    if (queueId.startsWith('QUEUE#MODE2')) {
      return handleMode2Release(queueId, queueMeta, force);
    }

    // Count current active (admitted + admitting but not yet expired)
    const now = Math.floor(Date.now() / 1000);
    const activeEntries = await queryQueueEntries(queueId, { statuses: ['admitted', 'admitting'] });
    const currentActive = activeEntries.filter(e => !e.admissionExpiry || e.admissionExpiry > now).length;

    const availableSlots = MAX_ACTIVE_SESSIONS - currentActive;
    if (availableSlots <= 0) {
      logger.info(`Queue ${queueId}: ceiling reached (${currentActive}/${MAX_ACTIVE_SESSIONS}), no release`);
      return { status: 'ceiling-reached', currentActive, maxActiveSessions: MAX_ACTIVE_SESSIONS };
    }

    // Get next batch of waiting entries, ordered by randomOrder
    const waitingEntries = await queryQueueEntries(queueId, { statuses: ['waiting'] });
    if (waitingEntries.length === 0) {
      // Only close if there are also no in-flight 'admitting' entries.
      // Concurrent Release invocations can temporarily move entries to 'admitting';
      // closing while they're in-flight would cause them to be stuck.
      const admittingEntries = await queryQueueEntries(queueId, { statuses: ['admitting'] });
      if (admittingEntries.length === 0) {
        await updateQueueMetaStatus(queueId, 'closed', 'releasing');
        logger.info(`Queue ${queueId}: all entries processed, closed`);
        return { status: 'closed', queueId };
      }
      logger.info(`Queue ${queueId}: no waiting entries but ${admittingEntries.length} admitting — waiting for them to resolve`);
      return { status: 'waiting-for-admitting', queueId };
    }

    // Sort by randomOrder (ascending)
    waitingEntries.sort((a, b) => (a.randomOrder ?? Infinity) - (b.randomOrder ?? Infinity));

    const batchSize = Math.min(RELEASE_BATCH_SIZE, availableSlots, waitingEntries.length);
    const batch = waitingEntries.slice(0, batchSize);

    logger.info(`Queue ${queueId}: admitting batch of ${batchSize} (${waitingEntries.length} waiting, ${availableSlots} slots)`);

    // Optimistic locking: try to reserve the batch slots
    const reserved = await incrementAdmittedCount(queueId, batchSize, MAX_ACTIVE_SESSIONS);
    if (!reserved) {
      logger.warn(`Queue ${queueId}: admittedCount increment failed (ceiling race), skipping release`);
      return { status: 'skipped', reason: 'ceiling-race' };
    }

    const hmacKey = await getHmacSigningKey();
    let successCount = 0;
    let failCount = 0;

    for (const entry of batch) {
      const cognitoSub = entry.cognitoSub;
      const admissionExpiry = now + ADMISSION_TTL_MINUTES * 60;

      // Generate admission token
      const token = generateToken(cognitoSub, entry.facilityKey, entry.dateKey, hmacKey, ADMISSION_TTL_MINUTES);

      // Phase 1: transition to 'admitting' with token
      const set = await setEntryAdmitting(queueId, cognitoSub, token, admissionExpiry);
      if (!set) {
        logger.warn(`Could not set admitting for ${cognitoSub} (status changed)`);
        failCount++;
        continue;
      }

      // Phase 2: push WebSocket notification
      const pushed = await pushAdmissionNotification(entry.connectionId);

      if (pushed) {
        // Success — transition to 'admitted'
        await setEntryAdmitted(queueId, cognitoSub);
        successCount++;
      } else {
        // Stale connection — revert to 'waiting' and free the reserved slot
        await updateQueueEntryStatus(queueId, cognitoSub, 'waiting', 'admitting');
        await decrementAdmittedCount(queueId, 1);
        failCount++;
        logger.info(`Reverted ${cognitoSub} to waiting (no WebSocket connection)`);
      }
    }

    logger.info(`Queue ${queueId}: released ${successCount} users (${failCount} reverted)`);
    return { status: 'released', queueId, admitted: successCount, reverted: failCount };

  } catch (err) {
    logger.error('WaitingRoom RELEASE error:', err);
    throw err;
  }
};
