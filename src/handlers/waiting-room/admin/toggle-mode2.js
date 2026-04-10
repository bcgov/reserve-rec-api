'use strict';

const { Exception, logger, sendResponse } = require('/opt/base');
const {
  CloudFrontClient,
  GetFunctionCommand,
  UpdateFunctionCommand,
  PublishFunctionCommand,
} = require('@aws-sdk/client-cloudfront');
const { putQueueMeta, updateQueueMetaStatus, scanQueuesByStatus, queryQueueEntries } = require('../utils/dynamodb');

const REGION = 'us-east-1'; // CloudFront is a global service, API endpoint is us-east-1

let _cfClient;
function getCFClient() {
  if (!_cfClient) {
    _cfClient = new CloudFrontClient({ region: REGION });
  }
  return _cfClient;
}

// Mode 2 OFF — pure pass-through (default deployed state)
const CODE_PASS_THROUGH = [
  'async function handler(event) {',
  '  return event.request;',
  '}',
].join('\n');

// Mode 2 ON — gate only the booking/checkout paths. Anonymous browsing, login,
// and all other navigation pass through unmodified so that guest users can still
// browse the site and authenticate normally.
// Admitted users carry a bcparks-admission cookie that lets them through.
// The intended destination is preserved as ?returnUrl= so the waiting room can
// redirect back to it after admission.
const CODE_GATE = [
  'async function handler(event) {',
  '  var request = event.request;',
  '  var uri = request.uri;',
  '  var gated = uri === \'/checkout\' || uri.startsWith(\'/checkout/\')',
  '           || uri === \'/reservation-flow\' || uri.startsWith(\'/reservation-flow/\')',
  '           || uri === \'/cart\' || uri.startsWith(\'/cart/\')',
  '           || uri === \'/facility\' || uri.startsWith(\'/facility/\')',
  '           || uri === \'/booking-confirmation\' || uri.startsWith(\'/booking-confirmation/\')',
  '           || uri === \'/payment-retry\';',
  '  if (!gated) {',
  '    return request;',
  '  }',
  '  var cookies = request.cookies;',
  "  if (cookies['bcparks-admission'] && cookies['bcparks-admission'].value) {",
  '    return request;',
  '  }',
  "  request.uri = '/waitingroom.html';",
  "  request.querystring = 'returnUrl=' + encodeURIComponent(uri);",
  '  return request;',
  '}',
].join('\n');

// Fixed queue identifiers for Mode 2 (site-wide gating, no specific facility)
const MODE2_COLLECTION_ID = 'MODE2';
const MODE2_ACTIVITY_TYPE = 'global';
const MODE2_ACTIVITY_ID = 1; // Non-zero so join handler validation passes

function getMode2QueueId() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `QUEUE#${MODE2_COLLECTION_ID}#${MODE2_ACTIVITY_TYPE}#${MODE2_ACTIVITY_ID}#${today}`;
}

exports.handler = async (event) => {
  logger.info('WaitingRoom admin TOGGLE-MODE2');

  try {
    const body = JSON.parse(event?.body || '{}');

    if (typeof body.active !== 'boolean') {
      throw new Exception('Missing required field: active (boolean)', { code: 400 });
    }

    const batchSize = typeof body.batchSize === 'number' ? body.batchSize : 50;
    const releaseIntervalSeconds = typeof body.releaseIntervalSeconds === 'number' ? body.releaseIntervalSeconds : 300;
    const releaseMode = body.releaseMode === 'manual' ? 'manual' : 'auto';

    if (batchSize < 1 || batchSize > 10000) {
      throw new Exception('batchSize must be between 1 and 10000', { code: 400 });
    }
    if (releaseIntervalSeconds < 30 || releaseIntervalSeconds > 86400) {
      throw new Exception('releaseIntervalSeconds must be between 30 and 86400', { code: 400 });
    }

    const functionName = process.env.VIEWER_FUNCTION_NAME;
    if (!functionName) {
      throw new Exception('VIEWER_FUNCTION_NAME not configured — Mode 2 CF Function not deployed', { code: 503 });
    }

    const client = getCFClient();

    // 1. Get current ETag and read the stored active queueId from the function comment
    //    (so deactivation uses the same queueId even if called past midnight UTC).
    const getResult = await client.send(new GetFunctionCommand({
      Name: functionName,
      Stage: 'LIVE',
    }));
    const etag = getResult.ETag;

    // Parse stored queueId from comment (format: "ACTIVE:<queueId>" when active)
    const existingComment = getResult.FunctionSummary?.FunctionConfig?.Comment || '';
    const storedQueueIdMatch = existingComment.match(/^ACTIVE:(.+)$/);

    // 2. Write DynamoDB record FIRST — if CloudFront update fails afterward,
    //    the gate is not active so serving 404 is prevented. Undo on CF failure.
    const queueId = body.active ? getMode2QueueId() : (storedQueueIdMatch?.[1] ?? getMode2QueueId());
    const now = Math.floor(Date.now() / 1000);

    if (body.active) {
      // Count existing waiting entries so totalEntries is correct on re-activation
      // (re-joining users return early from the join handler without incrementing the counter).
      const existingEntries = await queryQueueEntries(queueId, { statuses: ['waiting', 'admitting', 'admitted'] });
      const totalEntries = existingEntries.length;

      // Create (or reset) the Mode 2 queue in 'releasing' state.
      // Use unconditional put so re-activation on the same day works cleanly.
      await putQueueMeta({
        pk: queueId,
        sk: 'META',
        queueStatus: 'releasing',
        batchSize,
        releaseIntervalSeconds,
        releaseMode,
        lastReleasedAt: 0,
        totalEntries,
        admittedCount: 0,
        facilityKey: `${MODE2_COLLECTION_ID}#${MODE2_ACTIVITY_TYPE}#${MODE2_ACTIVITY_ID}`,
        openingTime: new Date().toISOString(), // used by join handler for TTL calc
        createdAt: now,
        updatedAt: now,
      });
      logger.info(`Mode 2 queue created: ${queueId} (batchSize=${batchSize}, interval=${releaseIntervalSeconds}s, releaseMode=${releaseMode})`);
    } else {
      // Close ALL releasing Mode 2 queues. Scanning rather than using the
      // comment-stored queueId handles the case where Mode 2 was activated on a
      // previous UTC day (queueId date would differ from today).
      const releasingQueues = await scanQueuesByStatus('releasing');
      const mode2Queues = releasingQueues.filter(q => q.pk && q.pk.startsWith('QUEUE#MODE2'));
      await Promise.all(mode2Queues.map(q => updateQueueMetaStatus(q.pk, 'closed')));
      logger.info(`Mode 2 deactivated: closed ${mode2Queues.length} queue(s)`);
    }

    // 3. Update the CloudFront function code. On failure, undo the DynamoDB write.
    let newEtag;
    try {
      // Embed the active queueId in the comment so deactivation can retrieve it
      // even if called past midnight UTC when getMode2QueueId() would return a different date.
      const comment = body.active
        ? `ACTIVE:${queueId}`
        : `WR Mode 2 viewer-request gate — PASS-THROUGH`;

      const newCode = body.active ? CODE_GATE : CODE_PASS_THROUGH;
      const updateResult = await client.send(new UpdateFunctionCommand({
        Name: functionName,
        IfMatch: etag,
        FunctionConfig: {
          Comment: comment,
          Runtime: 'cloudfront-js-2.0',
        },
        FunctionCode: Buffer.from(newCode),
      }));
      newEtag = updateResult.ETag;
    } catch (cfErr) {
      // Undo the DynamoDB write to keep state consistent
      if (body.active) {
        await updateQueueMetaStatus(queueId, 'closed').catch(e =>
          logger.error('toggle-mode2: failed to undo DynamoDB queue after CF error:', e.message)
        );
      }
      throw cfErr;
    }

    // 4. Publish (DEVELOPMENT → LIVE)
    await client.send(new PublishFunctionCommand({
      Name: functionName,
      IfMatch: newEtag,
    }));

    const publishedAt = now;
    logger.info(`Mode 2 toggled: active=${body.active}, function=${functionName}`);

    return sendResponse(200, {
      active: body.active,
      functionName,
      queueId,
      batchSize: body.active ? batchSize : undefined,
      releaseIntervalSeconds: body.active ? releaseIntervalSeconds : undefined,
      releaseMode: body.active ? releaseMode : undefined,
      publishedAt,
    }, `Mode 2 ${body.active ? 'activated' : 'deactivated'}`);

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom TOGGLE-MODE2 error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
