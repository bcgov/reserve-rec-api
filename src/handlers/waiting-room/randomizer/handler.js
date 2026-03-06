'use strict';

const { logger } = require('/opt/base');
const {
  getQueueMeta,
  updateQueueMetaStatus,
  queryQueueEntries,
  batchWriteEntries,
} = require('../utils/dynamodb');

const MIN_IP_SPACING = 5; // Minimum positions between entries from same IP after spread

/**
 * Fisher-Yates shuffle — mutates the array in place.
 */
function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * IP-aware spread: ensures entries from the same IP are at least MIN_IP_SPACING apart.
 * After the initial shuffle, iterates and swaps clustered same-IP entries with
 * a random entry outside the spacing window.
 *
 * @param {object[]} arr - Shuffled entries (each has a clientIp field)
 * @returns {object[]} Same array, mutated
 */
function applyIpSpread(arr) {
  // Budget caps total swaps to prevent pathological looping on IP-heavy inputs.
  // In practice each entry needs at most a few swaps; arr.length is generous.
  let swapBudget = arr.length;

  for (let i = 0; i < arr.length; i++) {
    const ip = arr[i].clientIp;
    if (!ip || ip === 'unknown') continue;

    // Check whether this entry violates spacing with a previous same-IP entry
    let violated = false;
    for (let j = Math.max(0, i - MIN_IP_SPACING); j < i; j++) {
      if (arr[j].clientIp === ip) { violated = true; break; }
    }
    if (!violated) continue;

    // Too close — find candidates beyond the forward window whose own IP
    // also won't cluster at position i (fix: validate destination for candidate).
    const candidates = [];
    for (let k = i + MIN_IP_SPACING; k < arr.length; k++) {
      if (arr[k].clientIp === ip) continue;
      const cIp = arr[k].clientIp;
      if (cIp && cIp !== 'unknown') {
        let cViolates = false;
        const winStart = Math.max(0, i - MIN_IP_SPACING);
        const winEnd = Math.min(arr.length - 1, i + MIN_IP_SPACING);
        for (let m = winStart; m <= winEnd; m++) {
          if (m === i) continue;
          if (arr[m].clientIp === cIp) { cViolates = true; break; }
        }
        if (cViolates) continue;
      }
      candidates.push(k);
    }

    if (candidates.length > 0 && swapBudget > 0) {
      const swapIdx = candidates[Math.floor(Math.random() * candidates.length)];
      [arr[i], arr[swapIdx]] = [arr[swapIdx], arr[i]];
      swapBudget--;
      i--; // Re-examine the newly placed element at position i
    }
    // No valid candidate or budget exhausted — leave in place (best effort)
  }
  return arr;
}

module.exports._applyIpSpread = applyIpSpread; // exported for unit tests

/**
 * Randomizer Lambda handler.
 * Triggered by EventBridge Scheduler at queue openingTime.
 * Also invokable by Queue Monitor as a safety net.
 *
 * Expected event: { queueId: "QUEUE#..." }
 */
exports.handler = async (event, context) => {
  const queueId = event?.queueId;
  logger.info('WaitingRoom RANDOMIZER:', { queueId });

  if (!queueId) {
    logger.error('Randomizer called without queueId');
    return { status: 'error', message: 'Missing queueId' };
  }

  try {
    // Step 1: Atomically transition to 'randomizing' (only if currently 'pre-open')
    const transitioned = await updateQueueMetaStatus(queueId, 'randomizing', 'pre-open');
    if (!transitioned) {
      const meta = await getQueueMeta(queueId);
      logger.warn(`Randomizer: queue ${queueId} not in pre-open state (current: ${meta?.queueStatus})`);
      return { status: 'skipped', reason: 'not-pre-open', currentStatus: meta?.queueStatus };
    }

    logger.info(`Queue ${queueId}: transitioned to randomizing`);

    // Step 2: Query all 'waiting' entries.
    // Setting status BEFORE querying means late joiners that write AFTER this point
    // get appended via incrementQueueTotalEntries in the join handler — they will have
    // no randomOrder field. The release handler handles this via `?? Infinity` in its
    // sort, placing late joiners at the end of the queue behind all randomized entries.
    const entries = await queryQueueEntries(queueId, { statuses: ['waiting'] });
    logger.info(`Queue ${queueId}: ${entries.length} waiting entries to randomize`);

    if (entries.length === 0) {
      // No entries — close immediately
      await updateQueueMetaStatus(queueId, 'closed', 'randomizing');
      logger.info(`Queue ${queueId}: no entries, closed immediately`);
      return { status: 'closed', queueId, entriesProcessed: 0 };
    }

    // Idempotency check: if any entries already have randomOrder assigned, a previous
    // invocation completed Step 4 (the write) but failed before or during Step 5
    // (the 'releasing' transition). Skip re-shuffling — the existing order is already
    // written — and go straight to retrying the transition.
    const alreadyRandomized = entries.some(e => e.randomOrder != null);
    if (alreadyRandomized) {
      logger.warn(`Queue ${queueId}: randomOrder already assigned on ${entries.length} entries — previous run completed write, retrying Step 5 transition`);
    } else {
      // Step 3: Fisher-Yates shuffle + IP spread
      const shuffled = applyIpSpread(fisherYates([...entries]));

      // Step 4: Assign randomOrder (0-based) and write back
      const now = Math.floor(Date.now() / 1000);
      const updatedEntries = shuffled.map((entry, idx) => ({
        ...entry,
        randomOrder: idx,
        updatedAt: now,
      }));

      try {
        await batchWriteEntries(updatedEntries);
        logger.info(`Queue ${queueId}: wrote randomOrder for ${updatedEntries.length} entries`);
      } catch (writeErr) {
        // Write failed — revert to pre-open so the Queue Monitor stale-timeout or
        // EventBridge retry will re-enter the randomizer cleanly. A partial write is
        // possible; on the next run the idempotency check above will detect any already-
        // written entries and skip re-shuffling.
        logger.error(`Queue ${queueId}: batchWriteEntries failed, attempting revert to pre-open`, writeErr);
        try {
          await updateQueueMetaStatus(queueId, 'pre-open', 'randomizing');
          logger.info(`Queue ${queueId}: reverted to pre-open after write failure`);
        } catch (revertErr) {
          logger.error(`Queue ${queueId}: CRITICAL — failed to revert to pre-open after write failure; queue is stuck in randomizing`, revertErr);
        }
        throw writeErr;
      }
    }

    // Step 5: Transition to 'releasing'
    try {
      await updateQueueMetaStatus(queueId, 'releasing', 'randomizing');
      logger.info(`Queue ${queueId}: transitioned to releasing`);
    } catch (transitionErr) {
      // randomOrder is already written — the queue is ready to release but stuck in
      // 'randomizing'. The Queue Monitor stale-timeout will reset it to pre-open, at
      // which point the next Randomizer invocation will detect the existing randomOrder
      // values via the idempotency check above and retry only this transition.
      // To manually recover: set queueStatus from 'randomizing' to 'releasing' for
      // queueId=${queueId} (${entries.length} entries already have randomOrder assigned).
      logger.error(
        `Queue ${queueId}: CRITICAL — randomOrder written for ${entries.length} entries but ` +
        `transition to releasing failed; queue stuck in randomizing. ` +
        `Manual recovery: update queueStatus to 'releasing'.`,
        transitionErr
      );
      throw transitionErr;
    }

    return { status: 'releasing', queueId, entriesProcessed: entries.length };

  } catch (err) {
    logger.error('WaitingRoom RANDOMIZER error:', err);
    throw err; // Let EventBridge retry on failure
  }
};
