'use strict';

const { logger } = require('/opt/base');
const {
  scanQueuesByStatus,
  updateQueueMetaStatus,
} = require('../utils/dynamodb');

const STALE_RANDOMIZING_TIMEOUT_MINUTES = parseInt(process.env.STALE_RANDOMIZING_TIMEOUT_MINUTES || '5', 10);

let _lambdaClient;
function getLambdaClient() {
  if (!_lambdaClient) {
    const { LambdaClient } = require('@aws-sdk/client-lambda');
    _lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ca-central-1' });
  }
  return _lambdaClient;
}

/**
 * Asynchronously invokes a Lambda function.
 */
async function invokeLambda(functionArn, payload) {
  const { InvokeCommand } = require('@aws-sdk/client-lambda');
  await getLambdaClient().send(new InvokeCommand({
    FunctionName: functionArn,
    InvocationType: 'Event', // async, fire-and-forget
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
}

/**
 * Queue Monitor Lambda handler.
 * Runs every 60 seconds via EventBridge cron.
 *
 * Responsibilities:
 *   1. Safety net: trigger Randomizer for pre-open queues past opening time
 *   2. Stale detection: reset 'randomizing' queues stuck > staleTimeoutMinutes → pre-open
 *   3. Invoke Release Lambda once per 'releasing' queue
 */
exports.handler = async (event, context) => {
  logger.info('WaitingRoom QUEUE MONITOR running');

  // Read ARNs at invocation time so tests can set process.env before handler runs
  const RANDOMIZER_LAMBDA_ARN = process.env.RANDOMIZER_LAMBDA_ARN;
  const RELEASE_LAMBDA_ARN = process.env.RELEASE_LAMBDA_ARN;

  const now = Math.floor(Date.now() / 1000);
  let randomizedCount = 0;
  let staleResetCount = 0;
  let releaseInvokedCount = 0;

  try {
    // 1. Safety net: find pre-open queues where openingTime has passed
    const preOpenQueues = await scanQueuesByStatus('pre-open');
    for (const queue of preOpenQueues) {
      const openingTime = Math.floor(new Date(queue.openingTime).getTime() / 1000);
      if (openingTime <= now) {
        logger.info(`Queue Monitor: triggering randomizer for overdue queue ${queue.pk}`);
        if (RANDOMIZER_LAMBDA_ARN) {
          try {
            await invokeLambda(RANDOMIZER_LAMBDA_ARN, { queueId: queue.pk });
            randomizedCount++;
          } catch (err) {
            logger.error(`Queue Monitor: failed to invoke randomizer for ${queue.pk}:`, err.message);
          }
        } else {
          logger.warn('RANDOMIZER_LAMBDA_ARN not set — cannot invoke randomizer');
        }
      }
    }

    // 2. Stale detection: reset 'randomizing' queues that have been stuck
    const staleThreshold = now - STALE_RANDOMIZING_TIMEOUT_MINUTES * 60;
    const randomizingQueues = await scanQueuesByStatus('randomizing');
    for (const queue of randomizingQueues) {
      if (queue.updatedAt && queue.updatedAt < staleThreshold) {
        logger.warn(`Queue Monitor: resetting stale randomizing queue ${queue.pk}`);
        try {
          const reset = await updateQueueMetaStatus(queue.pk, 'pre-open', 'randomizing');
          if (reset) staleResetCount++;
        } catch (err) {
          logger.error(`Queue Monitor: failed to reset stale queue ${queue.pk}:`, err.message);
        }
      }
    }

    // 3. Invoke Release Lambda for each 'releasing' queue
    //    Skip Mode 2 queues in 'manual' releaseMode — admin triggers releases on demand
    const releasingQueues = await scanQueuesByStatus('releasing');
    for (const queue of releasingQueues) {
      if (queue.pk.startsWith('QUEUE#MODE2') && queue.releaseMode === 'manual') {
        logger.info(`Queue Monitor: skipping manual-mode Mode 2 queue ${queue.pk}`);
        continue;
      }
      if (RELEASE_LAMBDA_ARN) {
        logger.info(`Queue Monitor: invoking release for queue ${queue.pk}`);
        try {
          await invokeLambda(RELEASE_LAMBDA_ARN, { queueId: queue.pk });
          releaseInvokedCount++;
        } catch (err) {
          logger.error(`Queue Monitor: failed to invoke release for ${queue.pk}:`, err.message);
        }
      } else {
        logger.warn('RELEASE_LAMBDA_ARN not set — cannot invoke release');
      }
    }

    logger.info('Queue Monitor complete:', { randomizedCount, staleResetCount, releaseInvokedCount });
    return { randomizedCount, staleResetCount, releaseInvokedCount };

  } catch (err) {
    logger.error('WaitingRoom QUEUE MONITOR error:', err);
    throw err;
  }
};
