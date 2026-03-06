'use strict';

const crypto = require('crypto');

/**
 * Generates an HMAC-SHA256 admission token.
 * Format: base64url(JSON.stringify(payload)).hex(HMAC-SHA256(payloadB64, secret))
 *
 * @param {string} sub - Cognito user sub
 * @param {string} facilityKey - collectionId#activityType#activityId
 * @param {string} dateKey - startDate (YYYY-MM-DD)
 * @param {string} secretKey - HMAC signing key from Secrets Manager
 * @param {number} ttlMinutes - Token TTL in minutes (default 15)
 * @returns {string} Token string
 */
function generateToken(sub, facilityKey, dateKey, secretKey, ttlMinutes = 15) {
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = {
    sid: sub,
    fk: facilityKey,
    dk: dateKey,
    iat: now,
    exp: now + ttlMinutes * 60,
    nonce,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

/**
 * Validates an admission token.
 *
 * @param {string} tokenStr - Token string from cookie
 * @param {string} secretKey - HMAC signing key from Secrets Manager
 * @returns {object|null} Decoded payload if valid and not expired, null otherwise
 */
function validateToken(tokenStr, secretKey) {
  if (!tokenStr || !secretKey) return null;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  let expectedSig;
  try {
    expectedSig = crypto.createHmac('sha256', secretKey).update(payloadB64).digest('hex');
  } catch {
    return null;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (!payload.sid || !payload.fk || !payload.dk) return null;

  return payload;
}

/**
 * Parses the bcparks-admission cookie from a cookie header string.
 *
 * @param {string} cookieHeader - Cookie header value
 * @returns {string|null} Token string or null
 */
function parseAdmissionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name.trim() === 'bcparks-admission') {
      return rest.join('=').trim();
    }
  }
  return null;
}

/**
 * Builds a Set-Cookie header value for the admission token.
 *
 * @param {string} token - Token string
 * @param {number} ttlMinutes - TTL in minutes
 * @returns {string} Set-Cookie header value
 */
function buildAdmissionCookieHeader(token, ttlMinutes) {
  const maxAge = ttlMinutes * 60;
  return `bcparks-admission=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Builds a Set-Cookie header that clears the admission cookie.
 */
function clearAdmissionCookieHeader() {
  return 'bcparks-admission=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

module.exports = {
  generateToken,
  validateToken,
  parseAdmissionCookie,
  buildAdmissionCookieHeader,
  clearAdmissionCookieHeader,
};
