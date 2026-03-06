'use strict';

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require('/opt/base');
const { getQueueEntry, updateQueueEntryStatus } = require('../utils/dynamodb');
const {
  parseAdmissionCookie,
  validateToken,
  generateToken,
  buildAdmissionCookieHeader,
  clearAdmissionCookieHeader,
} = require('../utils/token');
const { getHmacSigningKey } = require('../utils/secrets');

const ADMISSION_TTL_MINUTES = parseInt(process.env.ADMISSION_TTL_MINUTES || '15', 10);
const MAX_ADMISSION_MINUTES = parseInt(process.env.MAX_ADMISSION_MINUTES || '30', 10);

exports.handler = async (event, context) => {
  logger.info('WaitingRoom HEARTBEAT:', { path: event.path, method: event.httpMethod });

  try {
    // Require Cognito auth
    const claims = getRequestClaimsFromEvent(event);
    if (!claims || !claims.sub) {
      throw new Exception('Authentication required', { code: 401 });
    }
    const cognitoSub = claims.sub;

    // Parse and validate the admission cookie
    const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
    const admissionToken = parseAdmissionCookie(cookieHeader);

    if (!admissionToken) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No admission token', code: 'NO_TOKEN' }),
      };
    }

    const hmacKey = await getHmacSigningKey();
    const payload = validateToken(admissionToken, hmacKey);

    if (!payload) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearAdmissionCookieHeader(),
        },
        body: JSON.stringify({ error: 'Admission expired', code: 'EXPIRED' }),
      };
    }

    if (payload.sid !== cognitoSub) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearAdmissionCookieHeader(),
        },
        body: JSON.stringify({ error: 'Admission mismatch', code: 'USER_MISMATCH' }),
      };
    }

    // Get queueId from request body
    const body = JSON.parse(event?.body || '{}');
    const { queueId } = body;
    if (!queueId) {
      throw new Exception('Missing required field: queueId', { code: 400 });
    }

    // Verify the queue entry is still admitted
    const entry = await getQueueEntry(queueId, cognitoSub);
    if (!entry || entry.status !== 'admitted') {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearAdmissionCookieHeader(),
        },
        body: JSON.stringify({ error: 'Admission expired or revoked', code: 'EXPIRED' }),
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const admittedAt = entry.admittedAt || payload.iat;
    const maxExpiryTime = admittedAt + MAX_ADMISSION_MINUTES * 60;

    // Check absolute max admission time
    if (now >= maxExpiryTime) {
      await updateQueueEntryStatus(queueId, cognitoSub, 'expired', 'admitted');
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearAdmissionCookieHeader(),
        },
        body: JSON.stringify({ error: 'Maximum admission time reached', code: 'MAX_TIME' }),
      };
    }

    // Calculate new expiry — the smaller of ADMISSION_TTL_MINUTES from now and the absolute max
    const newExpiry = Math.min(now + ADMISSION_TTL_MINUTES * 60, maxExpiryTime);
    const newTtlMinutes = Math.ceil((newExpiry - now) / 60);

    // Generate refreshed token
    const newToken = generateToken(cognitoSub, payload.fk, payload.dk, hmacKey, newTtlMinutes);

    // Update DynamoDB — conditional on entry still being 'admitted'
    const updated = await updateQueueEntryStatus(queueId, cognitoSub, 'admitted', 'admitted', {
      admissionToken: newToken,
      admissionExpiry: newExpiry,
    });

    if (!updated) {
      // Concurrent update (e.g., cleanup Lambda expired it between our check and our update)
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': clearAdmissionCookieHeader(),
        },
        body: JSON.stringify({ error: 'Admission expired', code: 'EXPIRED' }),
      };
    }

    logger.info(`Heartbeat extended admission for ${cognitoSub}, new expiry: ${newExpiry}`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildAdmissionCookieHeader(newToken, newTtlMinutes),
      },
      body: JSON.stringify({
        tokenExpiry: newExpiry,
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
