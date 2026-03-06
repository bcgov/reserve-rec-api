'use strict';

const { generateToken, validateToken, parseAdmissionCookie, buildAdmissionCookieHeader, clearAdmissionCookieHeader } = require('../../src/handlers/waiting-room/utils/token');

const SECRET = 'test-hmac-secret-key-for-unit-tests';

describe('token utilities', () => {
  describe('generateToken', () => {
    it('generates a token with two parts separated by a dot', () => {
      const token = generateToken('user-123', 'coll#camping#sites', '2025-06-15', SECRET);
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[a-f0-9]+$/);
    });

    it('encodes the expected payload fields', () => {
      const token = generateToken('user-123', 'coll#camping#sites', '2025-06-15', SECRET, 15);
      const [payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

      expect(payload.sid).toBe('user-123');
      expect(payload.fk).toBe('coll#camping#sites');
      expect(payload.dk).toBe('2025-06-15');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.nonce).toBeDefined();
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('uses unique nonces for two tokens generated at the same time', () => {
      const t1 = generateToken('user', 'fk', 'dk', SECRET);
      const t2 = generateToken('user', 'fk', 'dk', SECRET);
      const p1 = JSON.parse(Buffer.from(t1.split('.')[0], 'base64url').toString());
      const p2 = JSON.parse(Buffer.from(t2.split('.')[0], 'base64url').toString());
      expect(p1.nonce).not.toBe(p2.nonce);
    });
  });

  describe('validateToken', () => {
    it('returns the payload for a valid token', () => {
      const token = generateToken('user-123', 'fk', '2025-06-15', SECRET, 15);
      const payload = validateToken(token, SECRET);
      expect(payload).not.toBeNull();
      expect(payload.sid).toBe('user-123');
      expect(payload.fk).toBe('fk');
      expect(payload.dk).toBe('2025-06-15');
    });

    it('returns null for a tampered payload', () => {
      const token = generateToken('user-123', 'fk', 'dk', SECRET);
      const [, sig] = token.split('.');
      const fakePaylod = Buffer.from(JSON.stringify({ sid: 'attacker', fk: 'fk', dk: 'dk', exp: 9999999999, nonce: 'x' })).toString('base64url');
      const tampered = `${fakePaylod}.${sig}`;
      expect(validateToken(tampered, SECRET)).toBeNull();
    });

    it('returns null for a wrong signing key', () => {
      const token = generateToken('user-123', 'fk', 'dk', SECRET);
      expect(validateToken(token, 'wrong-key')).toBeNull();
    });

    it('returns null for an expired token', () => {
      jest.useFakeTimers();
      const token = generateToken('user-123', 'fk', 'dk', SECRET, 1); // 1 minute TTL
      jest.advanceTimersByTime(2 * 60 * 1000); // advance 2 minutes
      expect(validateToken(token, SECRET)).toBeNull();
      jest.useRealTimers();
    });

    it('returns null for a malformed token (no dot)', () => {
      expect(validateToken('notadottoken', SECRET)).toBeNull();
    });

    it('returns null for null/undefined inputs', () => {
      expect(validateToken(null, SECRET)).toBeNull();
      expect(validateToken('token', null)).toBeNull();
    });
  });

  describe('parseAdmissionCookie', () => {
    it('extracts the bcparks-admission cookie', () => {
      const header = 'session=abc; bcparks-admission=payload.sig; other=xyz';
      expect(parseAdmissionCookie(header)).toBe('payload.sig');
    });

    it('returns null when cookie is absent', () => {
      expect(parseAdmissionCookie('session=abc; other=xyz')).toBeNull();
    });

    it('returns null for null/empty input', () => {
      expect(parseAdmissionCookie(null)).toBeNull();
      expect(parseAdmissionCookie('')).toBeNull();
    });
  });

  describe('buildAdmissionCookieHeader', () => {
    it('builds the correct Set-Cookie header', () => {
      const header = buildAdmissionCookieHeader('mytoken', 15);
      expect(header).toBe('bcparks-admission=mytoken; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900');
    });
  });

  describe('clearAdmissionCookieHeader', () => {
    it('builds a clearing Set-Cookie header', () => {
      const header = clearAdmissionCookieHeader();
      expect(header).toContain('bcparks-admission=');
      expect(header).toContain('Max-Age=0');
    });
  });
});
