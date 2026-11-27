'use strict';

const { Exception, logger, sendResponse, getRequestClaimsFromEvent, getClientIp, getHeaderValue } = require('/opt/base');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const {
  JwtBaseError,
  FetchError,
  JwksValidationError,
  JwkValidationError,
  KidNotFoundInJwksError,
  WaitPeriodNotYetEndedJwkError,
  JwksNotAvailableInCacheError,
} = require('aws-jwt-verify/error');
const {
  buildQueueId,
  getQueueMeta,
  getQueueEntry,
  putQueueEntry,
  incrementQueueTotalEntries,
  queryEntriesByUserId,
  queryEntriesByClientIp,
  abandonQueueEntry,
  incrementAbandonedCount,
  getActiveMode2QueueId,
} = require('../utils/dynamodb');
const { accountStatus } = require('/opt/accountStatus');

const MAX_ENTRIES_PER_IP = parseInt(process.env.MAX_ENTRIES_PER_IP || '4', 10);
const TTL_BUFFER_HOURS = 25; // Entry TTL: queue openingTime + 25h (covers post-close cleanup)
const MODE2_COLLECTION_ID = 'MODE2';

// Errors from fetching or reading Cognito's JWKS, not from the token itself. An unknown
// kid counts too: right after a key rotation the cached JWKS lacks the new key.
const JWKS_ERRORS = [
  FetchError,
  JwksValidationError,
  JwkValidationError,
  KidNotFoundInJwksError,
  WaitPeriodNotYetEndedJwkError,
  JwksNotAvailableInCacheError,
];

let idTokenVerifier;
function getIdTokenVerifier() {
  const userPoolId = process.env.PUBLIC_USER_POOL_ID;
  const clientId = process.env.PUBLIC_USER_POOL_CLIENT_ID;
  if (!userPoolId || !clientId) throw new Error('PUBLIC_USER_POOL_ID or PUBLIC_USER_POOL_CLIENT_ID not configured');
  // One verifier per container, so the JWKS is fetched once and cached.
  idTokenVerifier ??= CognitoJwtVerifier.create({ userPoolId, tokenUse: 'id', clientId });
  return idTokenVerifier;
}

const invalidIdToken = () =>
  new Exception('Sign in again to join the waiting room.', { code: 401, errorCode: 'ID_TOKEN_INVALID' });

/**
 * Refuses a join unless the X-Id-Token header holds a valid Cognito ID token for
 * the signed-in user whose email is verified (or who signed in with BCSC).
 * The ID token carries email_verified and identities, so no Cognito API call is made.
 */
async function requireVerifiedIdToken(event, claims) {
  const idToken = getHeaderValue(event?.headers, 'X-Id-Token');
  if (!idToken) throw invalidIdToken();

  let payload;
  try {
    payload = await getIdTokenVerifier().verify(idToken);
  } catch (err) {
    if (err instanceof JwtBaseError && !JWKS_ERRORS.some((type) => err instanceof type)) {
      logger.info('Waiting room ID token refused', { sub: claims.sub, error: err.message });
      throw invalidIdToken();
    }
    logger.error('Waiting room ID token check failed', { sub: claims.sub, error: err.message });
    throw new Exception("We couldn't check your account. Try again in a moment.", { code: 503, errorCode: 'ACCOUNT_CHECK_UNAVAILABLE' });
  }

  const status = accountStatus(payload, claims.sub);
  if (status === 'missing') {
    logger.info('Waiting room ID token belongs to another user', { sub: claims.sub });
    throw invalidIdToken();
  }
  if (status === 'unverified') {
    throw new Exception('Verify your email address to join the waiting room.', { code: 403, errorCode: 'EMAIL_UNVERIFIED' });
  }
}

exports.handler = async (event, context) => {
  logger.info('WaitingRoom JOIN:', { path: event.path, method: event.httpMethod });

  try {
    const claims = getRequestClaimsFromEvent(event);
    if (!claims || !claims.sub) {
      throw new Exception('Authentication required', { code: 401 });
    }
    const userId = claims.sub;

    const body = JSON.parse(event?.body || '{}');
    const { collectionId, activityType, activityId, startDate } = body;

    const isMode2 = collectionId === MODE2_COLLECTION_ID;

    if (!collectionId || !activityType || !activityId || (!startDate && !isMode2)) {
      throw new Exception('Missing required fields: collectionId, activityType, activityId, startDate', { code: 400 });
    }

    // Mode 2 joins the queue the pointer names; the client's date is ignored.
    const queueId = isMode2
      ? await getActiveMode2QueueId()
      : buildQueueId(collectionId, activityType, activityId, startDate);

    // Verify the queue exists
    const queueMeta = queueId && await getQueueMeta(queueId);
    if (!queueMeta) {
      throw new Exception('No waiting room queue found for this facility and date', { code: 404 });
    }

    const mode2Extras = isMode2 && queueMeta.firstReleaseAt
      ? { firstReleaseAt: queueMeta.firstReleaseAt }
      : {};

    // Check for existing entry BEFORE checking queue status — an admitted user who
    // reloads the page after queue closes should get their admission status back.
    const existingEntries = await queryEntriesByUserId(userId);
    const currentEntry = existingEntries.find(entry => entry.pk === queueId);
    if (currentEntry) {
      // Already in this queue — idempotent return (works even if queue is closed)
      return sendResponse(200, {
        queueId,
        status: currentEntry.status,
        joinedAt: currentEntry.joinedAt,
        openingTime: queueMeta.openingTime,
        queueStatus: queueMeta.queueStatus,
        ...mode2Extras,
      }, 'Already joined this queue');
    }

    // No existing entry — reject if queue is closed
    if (queueMeta.queueStatus === 'closed') {
      throw new Exception('Queue is closed. Book directly.', { code: 410 });
    }

    await requireVerifiedIdToken(event, claims);

    // Per-IP limit check
    const clientIp = getClientIp(event?.headers)
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

    // Joining here abandons any place held in another queue; only once every check has passed.
    for (const entry of existingEntries) {
      await abandonQueueEntry(entry.pk, userId);
      await incrementAbandonedCount(entry.pk, 1);
      logger.info(`Abandoned previous queue entry: ${entry.pk} for user ${userId}`);
    }

    // Entry expires 25 hours after the later of opening time and now: a Mode 2
    // queue keeps its openingTime across reactivations and can run past 25 h.
    const now = Math.floor(Date.now() / 1000);
    const openingTimeUnix = Math.floor(new Date(queueMeta.openingTime).getTime() / 1000);
    const entryTtl = Math.max(now, openingTimeUnix) + TTL_BUFFER_HOURS * 3600;

    const facilityKey = isMode2 ? queueMeta.facilityKey : `${collectionId}#${activityType}#${activityId}`;

    const entry = {
      pk: queueId,
      sk: `ENTRY#${userId}`,
      userId,
      clientIp,
      facilityKey,
      dateKey: isMode2 ? queueId.split('#').pop() : startDate,
      status: 'waiting',
      joinedAt: now,
      updatedAt: now,
      ttl: entryTtl,
    };

    // Strongly-consistent read before write — the GSI check above is eventually
    // consistent and may miss an active entry created milliseconds earlier.
    // This prevents unconditional PutItem from overwriting an admitted/admitting entry.
    const existingEntry = await getQueueEntry(queueId, userId);
    if (existingEntry && ['waiting', 'admitting', 'admitted'].includes(existingEntry.status)) {
      return sendResponse(200, {
        queueId,
        status: existingEntry.status,
        joinedAt: existingEntry.joinedAt,
        openingTime: queueMeta.openingTime,
        queueStatus: queueMeta.queueStatus,
        ...mode2Extras,
      }, 'Already joined this queue');
    }

    await putQueueEntry(entry);

    // Increment queue's totalEntries count
    await incrementQueueTotalEntries(queueId);

    logger.info(`User ${userId} joined queue ${queueId}`);

    return sendResponse(200, {
      queueId,
      status: 'waiting',
      joinedAt: now,
      openingTime: queueMeta.openingTime,
      queueStatus: queueMeta.queueStatus,
      ...mode2Extras,
    }, 'Successfully joined waiting room queue');

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err, context, err.errorCode ? { errorCode: err.errorCode } : null);
    }
    logger.error('WaitingRoom JOIN error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
