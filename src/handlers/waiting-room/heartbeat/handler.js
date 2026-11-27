'use strict';

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require('/opt/base');
const { getQueueEntry, updateQueueEntryStatus } = require('../utils/dynamodb');
const {
  parseAdmissionCookie,
  validateToken,
  issueAdmission,
  clearAdmissionCookieHeader,
} = require('../utils/token');
const { getHmacSigningKey } = require('../utils/secrets');

const ADMISSION_TTL_MINUTES = parseInt(process.env.ADMISSION_TTL_MINUTES || '15', 10);
const MAX_ADMISSION_MINUTES = parseInt(process.env.MAX_ADMISSION_MINUTES || '30', 10);

function deny(statusCode, error, code, clearCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (clearCookie) headers['Set-Cookie'] = clearAdmissionCookieHeader();
  return { statusCode, headers, body: JSON.stringify({ error, code }) };
}

exports.handler = async (event, context) => {
  logger.info('WaitingRoom HEARTBEAT:', { path: event.path, method: event.httpMethod });

  try {
    // Require Cognito auth
    const claims = getRequestClaimsFromEvent(event);
    if (!claims || !claims.sub) {
      throw new Exception('Authentication required', { code: 401 });
    }
    const userId = claims.sub;

    // Parse and validate the admission cookie
    const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
    const admissionToken = parseAdmissionCookie(cookieHeader);

    if (!admissionToken) {
      return deny(401, 'No admission token', 'NO_TOKEN', false);
    }

    const hmacKey = await getHmacSigningKey();
    const payload = validateToken(admissionToken, hmacKey);

    if (!payload) {
      return deny(403, 'Admission expired', 'EXPIRED');
    }

    if (payload.sid !== userId) {
      return deny(403, 'Admission mismatch', 'USER_MISMATCH');
    }

    // Get queueId from request body
    const body = JSON.parse(event?.body || '{}');
    const { queueId } = body;
    if (!queueId) {
      throw new Exception('Missing required field: queueId', { code: 400 });
    }

    // Verify the queue entry is still admitted
    const entry = await getQueueEntry(queueId, userId);
    if (!entry || entry.status !== 'admitted') {
      return deny(403, 'Admission expired or revoked', 'EXPIRED');
    }

    // Refuse a cookie minted for another queue; leave it set, as it is still valid there.
    if (payload.fk !== entry.facilityKey || payload.dk !== entry.dateKey) {
      return deny(403, 'Admission does not match this queue', 'QUEUE_MISMATCH', false);
    }

    const now = Math.floor(Date.now() / 1000);
    const maxExpiryTime = entry.admittedAt + MAX_ADMISSION_MINUTES * 60;

    // Check absolute max admission time
    if (now >= maxExpiryTime) {
      await updateQueueEntryStatus(queueId, userId, 'expired', 'admitted');
      return deny(403, 'Maximum admission time reached', 'MAX_TIME');
    }

    const admission = issueAdmission(
      userId, entry.facilityKey, entry.dateKey, hmacKey, ADMISSION_TTL_MINUTES, maxExpiryTime
    );
    if (!admission) {
      return deny(403, 'Admission expired', 'EXPIRED');
    }

    // Update DynamoDB — conditional on entry still being 'admitted'
    const updated = await updateQueueEntryStatus(queueId, userId, 'admitted', 'admitted', {
      admissionToken: admission.token,
      admissionExpiry: admission.exp,
    });

    if (!updated) {
      // Concurrent update (e.g., cleanup Lambda expired it between our check and our update)
      return deny(403, 'Admission expired', 'EXPIRED');
    }

    logger.info(`Heartbeat extended admission for ${userId}, new expiry: ${admission.exp}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': admission.cookie,
      },
      body: JSON.stringify({
        tokenExpiry: admission.exp,
        maxExpiryTime,
      }),
    };

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom HEARTBEAT error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
