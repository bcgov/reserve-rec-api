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
  return signToken(sub, facilityKey, dateKey, secretKey, now, now + ttlMinutes * 60);
}

function signToken(sub, facilityKey, dateKey, secretKey, iat, exp) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = { sid: sub, fk: facilityKey, dk: dateKey, iat, exp, nonce };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

/**
 * Issues an admission token and its Set-Cookie header, both expiring at the earlier of
 * now + ttlMinutes and notAfter, so neither outlives the entry's admission window.
 *
 * @param {string} sub - Cognito user sub
 * @param {string} facilityKey - collectionId#activityType#activityId
 * @param {string} dateKey - startDate (YYYY-MM-DD)
 * @param {string} secretKey - HMAC signing key from Secrets Manager
 * @param {number} ttlMinutes - Token TTL in minutes
 * @param {number} notAfter - Latest allowed expiry (epoch seconds)
 * @returns {{token: string, exp: number, cookie: string}|null} null if the window has closed
 */
function issueAdmission(sub, facilityKey, dateKey, secretKey, ttlMinutes, notAfter) {
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + ttlMinutes * 60, notAfter);
  // Also false for NaN, so a missing notAfter refuses rather than issuing uncapped.
  if (!(exp > now)) return null;
  const token = signToken(sub, facilityKey, dateKey, secretKey, now, exp);
  return { token, exp, cookie: admissionCookie(token, exp - now) };
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

function admissionCookie(token, maxAgeSeconds) {
  return `bcparks-admission=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * Builds a Set-Cookie header that clears the admission cookie.
 */
function clearAdmissionCookieHeader() {
  return admissionCookie('', 0);
}

module.exports = {
  generateToken,
  validateToken,
  parseAdmissionCookie,
  issueAdmission,
  clearAdmissionCookieHeader,
};
