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
  claimMode2Release,
  setEntryRandomOrder,
} = require('../utils/dynamodb');
const { generateToken } = require('../utils/token');
const { getHmacSigningKey } = require('../utils/secrets');
const { shuffleWithIpSpread } = require('../utils/shuffle');
const { createConnectionPoster, pushPositions } = require('../utils/push');

const MAX_ACTIVE_SESSIONS = parseInt(process.env.MAX_ACTIVE_SESSIONS || '100', 10);
const RELEASE_BATCH_SIZE = parseInt(process.env.RELEASE_BATCH_SIZE || '50', 10);
const RANDOM_ORDER_WRITE_CHUNK = 50;
const ADMISSION_TTL_MINUTES = parseInt(process.env.ADMISSION_TTL_MINUTES || '15', 10);
const THROTTLE_ERRORS = ['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded'];

async function writeRandomOrder(queueId, entry) {
  try {
    return await setEntryRandomOrder(queueId, entry.userId, entry.randomOrder);
  } catch (err) {
    if (!THROTTLE_ERRORS.includes(err.name)) throw err;
    return setEntryRandomOrder(queueId, entry.userId, entry.randomOrder);
  }
}

/**
 * Gives entries without a randomOrder a shuffled position after the current maximum.
 * In-memory values are set even if a write loses its race, so this release's order holds.
 */
async function assignRandomOrder(queueId, entries) {
  const fresh = entries.filter(e => e.randomOrder == null);
  if (fresh.length === 0) return;

  const base = entries.reduce((max, e) => Math.max(max, e.randomOrder ?? -1), -1) + 1;
  shuffleWithIpSpread(fresh).forEach((entry, idx) => {
    entry.randomOrder = base + idx;
  });

  let skipped = 0;
  for (let i = 0; i < fresh.length; i += RANDOM_ORDER_WRITE_CHUNK) {
    const results = await Promise.allSettled(
      fresh.slice(i, i + RANDOM_ORDER_WRITE_CHUNK).map(e => writeRandomOrder(queueId, e))
    );
    skipped += results.filter(r => r.status === 'rejected' || !r.value).length;
  }
  logger.info(`Mode2 queue ${queueId}: assigned randomOrder to ${fresh.length} entries (${skipped} skipped)`);
}

/**
 * Mode 2 (full-site gating) release: time-gated, no ceiling. New arrivals are shuffled
 * once and queued behind entries that already hold a randomOrder.
 */
async function handleMode2Release(queueId, queueMeta, force = false) {
  const now = Math.floor(Date.now() / 1000);
  const releaseIntervalSeconds = queueMeta.releaseIntervalSeconds || 300;
  const lastReleasedAt = queueMeta.lastReleasedAt || 0;

  if (!force && queueMeta.firstReleaseAt && Date.now() < Date.parse(queueMeta.firstReleaseAt)) {
    logger.info(`Mode2 queue ${queueId}: holding until first release at ${queueMeta.firstReleaseAt}`);
    return { status: 'waiting', reason: 'before-first-release', queueId };
  }

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

  // Only one release may run per interval: an admin force release, the scheduled one
  // and async retries can overlap, and lastReleasedAt is otherwise written last.
  if (!(await claimMode2Release(queueId, queueMeta.lastReleasedAt || 0, now))) {
    logger.info(`Mode2 queue ${queueId}: another release claimed this interval`);
    return { status: 'skipped', reason: 'release-in-progress', queueId };
  }

  await assignRandomOrder(queueId, waitingEntries);
  waitingEntries.sort((a, b) => a.randomOrder - b.randomOrder);

  const batchSize = Math.min(queueMeta.batchSize || 50, waitingEntries.length);
  const batch = waitingEntries.slice(0, batchSize);

  logger.info(`Mode2 queue ${queueId}: admitting batch of ${batchSize} (${waitingEntries.length} waiting)`);

  const postToConnection = createConnectionPoster();
  const hmacKey = await getHmacSigningKey();
  const facilityKey = queueMeta.facilityKey || 'MODE2#global#1';
  let successCount = 0;
  let failCount = 0;

  for (const entry of batch) {
    const userId = entry.userId;
    const admissionExpiry = now + ADMISSION_TTL_MINUTES * 60;

    const token = generateToken(userId, facilityKey, '', hmacKey, ADMISSION_TTL_MINUTES);

    const set = await setEntryAdmitting(queueId, userId, token, admissionExpiry);
    if (!set) {
      logger.warn(`Mode2: could not set admitting for ${userId} (status changed)`);
      failCount++;
      continue;
    }

    const pushed = (await postToConnection(entry.connectionId, { type: 'admitted' })) === 'sent';
    // Always mark admitted: with no live WS the user claims on next page load, when the
    // join handler returns 'admitted' and handleAdmission() redirects.
    await setEntryAdmitted(queueId, userId);
    successCount++;
    if (!pushed) {
      logger.info(`Mode2: admitted ${userId} without WS push (will claim on next page load)`);
    }
  }

  // Update lastReleasedAt and admittedCount for admin UI stats
  await updateQueueMetaLastReleasedAt(queueId, now, successCount);

  await pushPositions(postToConnection, waitingEntries.slice(batchSize));

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

    // ── MODE2 path: arrival-cohort shuffle, no ceiling, time-gated ──
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

    const postToConnection = createConnectionPoster();
    const hmacKey = await getHmacSigningKey();
    let successCount = 0;
    let failCount = 0;

    for (const entry of batch) {
      const userId = entry.userId;
      const admissionExpiry = now + ADMISSION_TTL_MINUTES * 60;

      // Generate admission token
      const token = generateToken(userId, entry.facilityKey, entry.dateKey, hmacKey, ADMISSION_TTL_MINUTES);

      // Phase 1: transition to 'admitting' with token
      const set = await setEntryAdmitting(queueId, userId, token, admissionExpiry);
      if (!set) {
        logger.warn(`Could not set admitting for ${userId} (status changed)`);
        failCount++;
        continue;
      }

      // Phase 2: push WebSocket notification
      const pushed = (await postToConnection(entry.connectionId, { type: 'admitted' })) === 'sent';

      if (pushed) {
        // Success — transition to 'admitted'
        await setEntryAdmitted(queueId, userId);
        successCount++;
      } else {
        // Stale connection — revert to 'waiting' and free the reserved slot
        await updateQueueEntryStatus(queueId, userId, 'waiting', 'admitting');
        await decrementAdmittedCount(queueId, 1);
        failCount++;
        logger.info(`Reverted ${userId} to waiting (no WebSocket connection)`);
      }
    }

    logger.info(`Queue ${queueId}: released ${successCount} users (${failCount} reverted)`);
    return { status: 'released', queueId, admitted: successCount, reverted: failCount };

  } catch (err) {
    logger.error('WaitingRoom RELEASE error:', err);
    throw err;
  }
};
