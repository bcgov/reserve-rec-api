'use strict';

const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require('/opt/base');
const { getQueueMeta, getQueueEntry } = require('../utils/dynamodb');
const { generateToken, buildAdmissionCookieHeader } = require('../utils/token');
const { getHmacSigningKey } = require('../utils/secrets');

const ADMISSION_TTL_MINUTES = parseInt(process.env.ADMISSION_TTL_MINUTES || '15', 10);

exports.handler = async (event, context) => {
  logger.info('WaitingRoom CLAIM:', { path: event.path, method: event.httpMethod });

  try {
    const claims = getRequestClaimsFromEvent(event);
    if (!claims || !claims.sub) {
      throw new Exception('Authentication required', { code: 401 });
    }
    const cognitoSub = claims.sub;

    const body = JSON.parse(event?.body || '{}');
    const { queueId } = body;
    if (!queueId) {
      throw new Exception('Missing required field: queueId', { code: 400 });
    }

    // Get queue entry for this user
    const entry = await getQueueEntry(queueId, cognitoSub);
    if (!entry) {
      throw new Exception('Queue entry not found', { code: 404 });
    }

    if (entry.status === 'expired' || entry.status === 'abandoned') {
      throw new Exception('Admission expired', { code: 403, errorCode: 'EXPIRED' });
    }

    if (entry.status !== 'admitted' && entry.status !== 'admitting') {
      throw new Exception('Not admitted to this queue yet', { code: 403, errorCode: 'NOT_ADMITTED' });
    }

    // Check admission hasn't expired
    const now = Math.floor(Date.now() / 1000);
    if (entry.admissionExpiry && entry.admissionExpiry < now) {
      throw new Exception('Admission expired', { code: 403, errorCode: 'EXPIRED' });
    }

    // Get queue meta for validation
    const queueMeta = await getQueueMeta(queueId);
    if (!queueMeta) {
      throw new Exception('Queue not found', { code: 404 });
    }

    // Generate a fresh HMAC token
    const hmacKey = await getHmacSigningKey();
    const token = generateToken(
      cognitoSub,
      entry.facilityKey,
      entry.dateKey,
      hmacKey,
      ADMISSION_TTL_MINUTES
    );

    const tokenExpiry = now + ADMISSION_TTL_MINUTES * 60;

    logger.info(`User ${cognitoSub} claimed admission for queue ${queueId}`);

    // Return Set-Cookie header with HttpOnly admission cookie
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildAdmissionCookieHeader(token, ADMISSION_TTL_MINUTES),
      },
      body: JSON.stringify({
        status: 'admitted',
        facilityKey: entry.facilityKey,
        dateKey: entry.dateKey,
        tokenExpiry,
        admittedAt: entry.admittedAt || now,
      }),
    };

  } catch (err) {
    logger.error('WaitingRoom CLAIM error:', err.message || err);
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message);
    }
    return sendResponse(500, null, 'Internal server error');
  }
};
