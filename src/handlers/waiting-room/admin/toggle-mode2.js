'use strict';

const { Exception, logger, sendResponse, checkAuthContext } = require('/opt/base');
const {
  CloudFrontClient,
  GetFunctionCommand,
  UpdateFunctionCommand,
  PublishFunctionCommand,
} = require('@aws-sdk/client-cloudfront');
const {
  putQueueMeta,
  updateQueueMetaStatus,
  scanQueuesByStatus,
  getQueueMeta,
  queryQueueEntries,
  updateQueueEntryStatus,
  getActiveMode2QueueId,
  setActiveMode2QueueId,
  clearActiveMode2QueueId,
} = require('../utils/dynamodb');

const REGION = 'us-east-1'; // CloudFront is a global service, API endpoint is us-east-1

let _cfClient;
function getCFClient() {
  if (!_cfClient) {
    _cfClient = new CloudFrontClient({ region: REGION });
  }
  return _cfClient;
}

// Viewer-request code builder. Two kinds of targets share one gate:
//
// prefix ''        — the standalone public distribution (root-mounted SPA). Deep-link
//                    fallback is handled by distribution-wide errorResponses, so
//                    inactive code is a pure pass-through, exactly as before.
// prefix '/dayuse' — the front door tenant behavior. CloudFront allows ONE
//                    viewer-request function per behavior and the front door has no
//                    distribution-wide fallback, so this function must ALWAYS carry
//                    the SPA deep-link fallback; the gate is layered in front of it.
//
// Gate semantics are unchanged: only booking/checkout paths are gated; admitted
// users carry a bcparks-admission cookie; the intended destination is preserved
// as ?returnUrl= so the waiting room can redirect back after admission.
function buildViewerFnCode(active, prefix) {
  const p = prefix || '';
  const lines = [
    'async function handler(event) {',
    '  var request = event.request;',
    '  var uri = request.uri;',
  ];
  if (active) {
    lines.push(
      `  var gated = uri === '${p}/checkout' || uri.startsWith('${p}/checkout/')`,
      `           || uri === '${p}/reservation-flow' || uri.startsWith('${p}/reservation-flow/')`,
      `           || uri === '${p}/cart' || uri.startsWith('${p}/cart/')`,
      `           || uri === '${p}/facility' || uri.startsWith('${p}/facility/')`,
      `           || uri === '${p}/booking-confirmation' || uri.startsWith('${p}/booking-confirmation/')`,
      `           || uri === '${p}/payment-retry';`,
      '  var cookies = request.cookies;',
      "  if (gated && !(cookies['bcparks-admission'] && cookies['bcparks-admission'].value)) {",
      `    request.uri = '${p}/waitingroom.html';`,
      "    request.querystring = 'returnUrl=' + encodeURIComponent(uri);",
      '    return request;',
      '  }',
    );
  }
  if (p) {
    lines.push(
      '  // SPA deep-link fallback: extension-less URIs resolve client-side.',
      "  if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {",
      `    request.uri = '${p}/index.html';`,
      '  }',
    );
  }
  lines.push('  return request;', '}');
  return lines.join('\n');
}

// The functions this toggle manages. The standalone distribution's fn is the
// primary; the front door's tenant fn is present only in environments where the
// front door is deployed.
function getTargets() {
  const targets = [];
  if (process.env.VIEWER_FUNCTION_NAME) {
    targets.push({ name: process.env.VIEWER_FUNCTION_NAME, prefix: '' });
  }
  if (process.env.FRONT_DOOR_VIEWER_FUNCTION_NAME) {
    targets.push({
      name: process.env.FRONT_DOOR_VIEWER_FUNCTION_NAME,
      prefix: process.env.FRONT_DOOR_TENANT_PREFIX || '/dayuse',
    });
  }
  return targets;
}

// Fixed queue identifiers for Mode 2 (site-wide gating, no specific facility)
const MAX_FIRST_RELEASE_AHEAD_MS = 24 * 60 * 60 * 1000;

const MODE2_COLLECTION_ID = 'MODE2';
const MODE2_ACTIVITY_TYPE = 'global';
const MODE2_ACTIVITY_ID = 1; // Non-zero so join handler validation passes

// Names a new queue only; readers find the active one through the pointer.
function newMode2QueueId() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `QUEUE#${MODE2_COLLECTION_ID}#${MODE2_ACTIVITY_TYPE}#${MODE2_ACTIVITY_ID}#${today}`;
}

exports.handler = async (event) => {
  logger.info('WaitingRoom admin TOGGLE-MODE2');

  try {
    checkAuthContext(event, 'superadmin');

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

    let firstReleaseAt;
    if (body.active && body.firstReleaseAt != null) {
      if (releaseMode === 'manual') {
        throw new Exception('firstReleaseAt applies to auto release only', { code: 400 });
      }
      const firstReleaseDate = new Date(typeof body.firstReleaseAt === 'string' ? body.firstReleaseAt : NaN);
      if (Number.isNaN(firstReleaseDate.getTime())) {
        throw new Exception('firstReleaseAt must be a valid ISO 8601 date', { code: 400 });
      }
      const msAhead = firstReleaseDate.getTime() - Date.now();
      if (msAhead <= 0) {
        throw new Exception('firstReleaseAt must be in the future', { code: 400 });
      }
      if (msAhead > MAX_FIRST_RELEASE_AHEAD_MS) {
        throw new Exception('firstReleaseAt must be no more than 24 hours ahead', { code: 400 });
      }
      firstReleaseAt = firstReleaseDate.toISOString();
    }

    const targets = getTargets();
    if (targets.length === 0) {
      throw new Exception('VIEWER_FUNCTION_NAME not configured — Mode 2 CF Function not deployed', { code: 503 });
    }

    const client = getCFClient();

    // Write DynamoDB FIRST — if CloudFront update fails afterward, the gate is
    // not active so serving 404 is prevented. Undo on CF failure.
    const activeQueueId = await getActiveMode2QueueId();
    const queueId = body.active ? (activeQueueId ?? newMode2QueueId()) : activeQueueId;
    const now = Math.floor(Date.now() / 1000);
    let previousMeta = null;

    if (body.active) {
      // Re-activating an existing same-day queue must preserve its counters —
      // entries (and their admitted status) survive across activate/deactivate
      // cycles, so recomputing/zeroing here would desync the meta from reality.
      // Only a brand-new queue (no prior meta) starts at 0/0.
      const existingMeta = await getQueueMeta(queueId);
      previousMeta = existingMeta;
      const totalEntries = existingMeta?.totalEntries ?? 0;
      const admittedCount = existingMeta?.admittedCount ?? 0;

      // Create (or reactivate) the Mode 2 queue in 'releasing' state.
      // Use unconditional put so re-activation on the same day works cleanly.
      await putQueueMeta({
        pk: queueId,
        sk: 'META',
        queueStatus: 'releasing',
        batchSize,
        releaseIntervalSeconds,
        releaseMode,
        ...(firstReleaseAt && { firstReleaseAt }),
        lastReleasedAt: existingMeta?.lastReleasedAt ?? 0,
        totalEntries,
        admittedCount,
        facilityKey: `${MODE2_COLLECTION_ID}#${MODE2_ACTIVITY_TYPE}#${MODE2_ACTIVITY_ID}`,
        openingTime: existingMeta?.openingTime ?? new Date().toISOString(), // used by join handler for TTL calc
        createdAt: existingMeta?.createdAt ?? now,
        updatedAt: now,
      });
      await setActiveMode2QueueId(queueId);
      logger.info(`Mode 2 queue created: ${queueId} (batchSize=${batchSize}, interval=${releaseIntervalSeconds}s, releaseMode=${releaseMode})`);
    } else {
      // Close ALL releasing Mode 2 queues, not just the pointer's, so a queue
      // orphaned by an earlier failed toggle is closed too.
      const releasingQueues = await scanQueuesByStatus('releasing');
      const mode2Queues = releasingQueues.filter(q => q.pk && q.pk.startsWith('QUEUE#MODE2'));
      await Promise.all(mode2Queues.map(q => updateQueueMetaStatus(q.pk, 'closed')));

      // Release any users still waiting/admitting in these queues — the CF gate
      // is about to become a pass-through, so clients must be told to bypass
      // rather than sit on waitingroom.html forever waiting for a release that
      // will never come (mirrors close-queue.js's force-close notification).
      const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
      let releasedCount = 0;
      for (const q of mode2Queues) {
        const activeEntries = await queryQueueEntries(q.pk, { statuses: ['waiting', 'admitting'] });
        for (const entry of activeEntries) {
          await updateQueueEntryStatus(entry.pk, entry.userId, 'abandoned', null, { abandonedAt: now });
          releasedCount++;
        }
        if (endpoint && activeEntries.length > 0) {
          const {
            ApiGatewayManagementApiClient,
            PostToConnectionCommand,
            DeleteConnectionCommand,
          } = require('@aws-sdk/client-apigatewaymanagementapi');
          const wsClient = new ApiGatewayManagementApiClient({ endpoint });
          const closedMsg = Buffer.from(JSON.stringify({ type: 'queueClosed' }));
          for (const entry of activeEntries) {
            if (!entry.connectionId) continue;
            try {
              await wsClient.send(new PostToConnectionCommand({ ConnectionId: entry.connectionId, Data: closedMsg }));
            } catch (err) {
              logger.warn(`Could not push queueClosed to ${entry.connectionId}: ${err.message}`);
            }
            try {
              await wsClient.send(new DeleteConnectionCommand({ ConnectionId: entry.connectionId }));
            } catch (err) {
              logger.warn(`Could not delete connection ${entry.connectionId}: ${err.message}`);
            }
          }
        }
      }

      // Cleared last: if closing fails, booking enforcement still finds the queue.
      await clearActiveMode2QueueId();

      logger.info(`Mode 2 deactivated: closed ${mode2Queues.length} queue(s), released ${releasedCount} waiting user(s)`);
    }

    // Update + publish each target's CloudFront function code.
    // On failure, undo the DynamoDB write. Targets are updated sequentially; if a
    // later target fails after an earlier one published, the error names which
    // functions succeeded so the operator can retry the toggle (idempotent).
    const comment = body.active
      ? `ACTIVE:${queueId}`
      : `WR Mode 2 viewer-request gate — PASS-THROUGH`;
    const published = [];
    try {
      for (const target of targets) {
        const targetGet = await client.send(new GetFunctionCommand({
          Name: target.name,
          Stage: 'LIVE',
        }));
        const updateResult = await client.send(new UpdateFunctionCommand({
          Name: target.name,
          IfMatch: targetGet.ETag,
          FunctionConfig: {
            Comment: comment,
            Runtime: 'cloudfront-js-2.0',
          },
          FunctionCode: Buffer.from(buildViewerFnCode(body.active, target.prefix)),
        }));
        await client.send(new PublishFunctionCommand({
          Name: target.name,
          IfMatch: updateResult.ETag,
        }));
        published.push(target.name);
      }
    } catch (cfErr) {
      logger.error(`toggle-mode2: CF update failed after publishing [${published.join(', ')}]:`, cfErr.message);
      // Undo only what this call changed: a queue that was already live keeps
      // running on its previous settings; a queue this call opened is closed again.
      if (body.active && activeQueueId && previousMeta?.queueStatus === 'releasing') {
        await putQueueMeta(previousMeta).catch(e =>
          logger.error('toggle-mode2: failed to restore the live queue after CF error:', e.message)
        );
      } else if (body.active) {
        await updateQueueMetaStatus(queueId, 'closed').catch(e =>
          logger.error('toggle-mode2: failed to undo DynamoDB queue after CF error:', e.message)
        );
        if (!activeQueueId) {
          await clearActiveMode2QueueId().catch(e =>
            logger.error('toggle-mode2: failed to clear the Mode 2 pointer after CF error:', e.message)
          );
        }
      }
      throw cfErr;
    }

    const publishedAt = now;
    logger.info(`Mode 2 toggled: active=${body.active}, functions=${published.join(', ')}`);

    return sendResponse(200, {
      active: body.active,
      functionName: targets[0].name,
      functionNames: published,
      queueId,
      batchSize: body.active ? batchSize : undefined,
      releaseIntervalSeconds: body.active ? releaseIntervalSeconds : undefined,
      releaseMode: body.active ? releaseMode : undefined,
      firstReleaseAt,
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
