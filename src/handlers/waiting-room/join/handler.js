'use strict';

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require('/opt/base');
const {
  buildQueueId,
  getQueueMeta,
  getQueueEntry,
  putQueueEntry,
  incrementQueueTotalEntries,
  queryEntriesByCognitoSub,
  queryEntriesByClientIp,
  abandonQueueEntry,
  incrementAbandonedCount,
} = require('../utils/dynamodb');

const MAX_ENTRIES_PER_IP = parseInt(process.env.MAX_ENTRIES_PER_IP || '4', 10);
const MIN_ACCOUNT_AGE_HOURS = parseInt(process.env.MIN_ACCOUNT_AGE_HOURS || '0', 10);
const TTL_BUFFER_HOURS = 25; // Entry TTL: queue openingTime + 25h (covers post-close cleanup)

exports.handler = async (event, context) => {
  logger.info('WaitingRoom JOIN:', { path: event.path, method: event.httpMethod });

  try {
    const claims = getRequestClaimsFromEvent(event);
    if (!claims || !claims.sub) {
      throw new Exception('Authentication required', { code: 401 });
    }
    const cognitoSub = claims.sub;

    const body = JSON.parse(event?.body || '{}');
    const { collectionId, activityType, activityId, startDate } = body;

    if (!collectionId || !activityType || !activityId || !startDate) {
      throw new Exception('Missing required fields: collectionId, activityType, activityId, startDate', { code: 400 });
    }

    const queueId = buildQueueId(collectionId, activityType, activityId, startDate);

    // Verify the queue exists
    const queueMeta = await getQueueMeta(queueId);
    if (!queueMeta) {
      throw new Exception('No waiting room queue found for this facility and date', { code: 404 });
    }

    // Check for existing entry BEFORE checking queue status — an admitted user who
    // reloads the page after queue closes should get their admission status back.
    const existingEntries = await queryEntriesByCognitoSub(cognitoSub);
    for (const entry of existingEntries) {
      if (entry.pk === queueId) {
        // Already in this queue — idempotent return (works even if queue is closed)
        return sendResponse(200, {
          queueId,
          status: entry.status,
          joinedAt: entry.joinedAt,
          openingTime: queueMeta.openingTime,
          queueStatus: queueMeta.queueStatus,
        }, 'Already joined this queue');
      }
      // In a different queue — abandon it
      await abandonQueueEntry(entry.pk, cognitoSub);
      await incrementAbandonedCount(entry.pk, 1);
      logger.info(`Abandoned previous queue entry: ${entry.pk} for user ${cognitoSub}`);
    }

    // No existing entry — reject if queue is closed
    if (queueMeta.queueStatus === 'closed') {
      throw new Exception('Queue is closed. Book directly.', { code: 410 });
    }

    // Account age check (if configured).
    // Uses cognito:user_creation_date JWT claim (Unix seconds) if available.
    // Falls back to AdminGetUser API when COGNITO_USER_POOL_ID env var is set.
    // auth_time/iat are NOT used — they reflect the most recent sign-in, not account creation.
    if (MIN_ACCOUNT_AGE_HOURS > 0) {
      let accountCreatedAt = null;

      if (claims['cognito:user_creation_date']) {
        accountCreatedAt = claims['cognito:user_creation_date'];
      } else if (process.env.COGNITO_USER_POOL_ID) {
        try {
          const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
          const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'ca-central-1' });
          const userResult = await cognitoClient.send(new AdminGetUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID,
            Username: cognitoSub,
          }));
          if (userResult.UserCreateDate) {
            accountCreatedAt = Math.floor(new Date(userResult.UserCreateDate).getTime() / 1000);
          }
        } catch (err) {
          logger.warn(`Could not fetch account creation time for ${cognitoSub}: ${err.message}. Skipping age check.`);
        }
      } else {
        logger.warn('MIN_ACCOUNT_AGE_HOURS set but cognito:user_creation_date claim unavailable and COGNITO_USER_POOL_ID not configured — age check skipped');
      }

      if (accountCreatedAt !== null) {
        const accountAgeHours = (Date.now() / 1000 - accountCreatedAt) / 3600;
        if (accountAgeHours < MIN_ACCOUNT_AGE_HOURS) {
          throw new Exception(
            `Account must be at least ${MIN_ACCOUNT_AGE_HOURS} hour(s) old to join a waiting room`,
            { code: 403, errorCode: 'ACCOUNT_TOO_NEW' }
          );
        }
      }
    }

    // Per-IP limit check
    const clientIp = event?.headers?.['CloudFront-Viewer-Address']?.split(':')[0]
      || event?.headers?.['X-Forwarded-For']?.split(',')[0]?.trim()
      || 'unknown';

    if (clientIp !== 'unknown' && MAX_ENTRIES_PER_IP > 0) {
      const ipEntries = await queryEntriesByClientIp(clientIp, queueId);
      if (ipEntries.length >= MAX_ENTRIES_PER_IP) {
        throw new Exception(
          `Too many waiting room sessions from this IP address (max: ${MAX_ENTRIES_PER_IP})`,
          { code: 429, errorCode: 'IP_LIMIT_EXCEEDED' }
        );
      }
    }

    // Calculate TTL — entry expires 25 hours after queue opening time
    const openingTimeUnix = Math.floor(new Date(queueMeta.openingTime).getTime() / 1000);
    const entryTtl = openingTimeUnix + TTL_BUFFER_HOURS * 3600;

    const facilityKey = `${collectionId}#${activityType}#${activityId}`;
    const now = Math.floor(Date.now() / 1000);

    const entry = {
      pk: queueId,
      sk: `ENTRY#${cognitoSub}`,
      cognitoSub,
      clientIp,
      facilityKey,
      dateKey: startDate,
      status: 'waiting',
      joinedAt: now,
      updatedAt: now,
      ttl: entryTtl,
    };

    // Strongly-consistent read before write — the GSI check above is eventually
    // consistent and may miss an active entry created milliseconds earlier.
    // This prevents unconditional PutItem from overwriting an admitted/admitting entry.
    const existingEntry = await getQueueEntry(queueId, cognitoSub);
    if (existingEntry && ['waiting', 'admitting', 'admitted'].includes(existingEntry.status)) {
      return sendResponse(200, {
        queueId,
        status: existingEntry.status,
        joinedAt: existingEntry.joinedAt,
        openingTime: queueMeta.openingTime,
        queueStatus: queueMeta.queueStatus,
      }, 'Already joined this queue');
    }

    await putQueueEntry(entry);

    // Increment queue's totalEntries count
    await incrementQueueTotalEntries(queueId);

    logger.info(`User ${cognitoSub} joined queue ${queueId}`);

    return sendResponse(200, {
      queueId,
      status: 'waiting',
      joinedAt: now,
      openingTime: queueMeta.openingTime,
      queueStatus: queueMeta.queueStatus,
    }, 'Successfully joined waiting room queue');

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom JOIN error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
