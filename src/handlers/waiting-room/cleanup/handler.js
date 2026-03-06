'use strict';

const { logger } = require('/opt/base');
const {
  scanExpiredEntries,
  updateQueueEntryStatus,
  incrementAbandonedCount,
  decrementAdmittedCount,
} = require('../utils/dynamodb');

const DISCONNECT_GRACE_PERIOD_SECONDS = parseInt(process.env.DISCONNECT_GRACE_PERIOD_SECONDS || '30', 10);
const ADMITTING_STUCK_THRESHOLD_SECONDS = 60;

let _lambdaClient;
function getLambdaClient() {
  if (!_lambdaClient) {
    const { LambdaClient } = require('@aws-sdk/client-lambda');
    _lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ca-central-1' });
  }
  return _lambdaClient;
}

async function invokeLambda(functionArn, payload) {
  const { InvokeCommand } = require('@aws-sdk/client-lambda');
  await getLambdaClient().send(new InvokeCommand({
    FunctionName: functionArn,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

/**
 * Cleanup Lambda handler.
 * Runs every 60 seconds via EventBridge cron.
 * Handles:
 *   1. Expired admissions (admissionExpiry < now)
 *   2. Disconnected entries past grace period
 *   3. Entries stuck in 'admitting' state > 60s (crash recovery)
 */
exports.handler = async (event, context) => {
  logger.info('WaitingRoom CLEANUP running');

  const RELEASE_LAMBDA_ARN = process.env.RELEASE_LAMBDA_ARN;
  const now = Math.floor(Date.now() / 1000);
  let expiredCount = 0;
  let abandonedCount = 0;
  let recoveredCount = 0;
  const freedQueues = new Set();

  try {
    // 1. Expire admitted entries past admissionExpiry
    const expiredAdmitted = await scanExpiredEntries('admitted', 'admissionExpiry', now);
    for (const entry of expiredAdmitted) {
      const updated = await updateQueueEntryStatus(entry.pk, entry.cognitoSub, 'expired', 'admitted');
      if (updated) {
        expiredCount++;
        freedQueues.add(entry.pk);
      }
    }
    logger.info(`Cleanup: expired ${expiredCount} admitted entries`);

    // 2. Abandon disconnected entries past grace period
    const graceThreshold = now - DISCONNECT_GRACE_PERIOD_SECONDS;
    const disconnectedEntries = await scanExpiredEntries('waiting', 'disconnectedAt', graceThreshold);
    const abandonedByQueue = {};
    for (const entry of disconnectedEntries) {
      const updated = await updateQueueEntryStatus(entry.pk, entry.cognitoSub, 'abandoned', 'waiting', {
        abandonedAt: now,
      });
      if (updated) {
        abandonedCount++;
        abandonedByQueue[entry.pk] = (abandonedByQueue[entry.pk] || 0) + 1;
        freedQueues.add(entry.pk);
      }
    }
    for (const [queueId, count] of Object.entries(abandonedByQueue)) {
      await incrementAbandonedCount(queueId, count);
    }
    logger.info(`Cleanup: abandoned ${abandonedCount} disconnected entries`);

    // 3. Recover entries stuck in 'admitting' for too long (Lambda crash recovery).
    // Decrement admittedCount for each recovered entry — the slot reserved by
    // incrementAdmittedCount in the release handler was never returned.
    const stuckThreshold = now - ADMITTING_STUCK_THRESHOLD_SECONDS;
    const stuckEntries = await scanExpiredEntries('admitting', 'admittedAt', stuckThreshold);
    const recoveredByQueue = {};
    for (const entry of stuckEntries) {
      const updated = await updateQueueEntryStatus(entry.pk, entry.cognitoSub, 'waiting', 'admitting');
      if (updated) {
        recoveredCount++;
        recoveredByQueue[entry.pk] = (recoveredByQueue[entry.pk] || 0) + 1;
      }
    }
    for (const [queueId, count] of Object.entries(recoveredByQueue)) {
      await decrementAdmittedCount(queueId, count);
    }
    logger.info(`Cleanup: recovered ${recoveredCount} stuck admitting entries`);

    // 4. Trigger Release Lambda for each queue where slots were freed, so freed
    //    capacity is filled without waiting for the next Queue Monitor tick.
    if (RELEASE_LAMBDA_ARN && freedQueues.size > 0) {
      for (const queueId of freedQueues) {
        try {
          await invokeLambda(RELEASE_LAMBDA_ARN, { queueId });
          logger.info(`Cleanup: triggered release for queue ${queueId}`);
        } catch (err) {
          logger.warn(`Cleanup: failed to invoke release for ${queueId}:`, err.message);
        }
      }
    }

    return { expiredCount, abandonedCount, recoveredCount };

  } catch (err) {
    logger.error('WaitingRoom CLEANUP error:', err);
    throw err;
  }
};
