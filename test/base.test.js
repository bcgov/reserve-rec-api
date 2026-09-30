const {
  sendResponse,
  checkWarmup,
  Exception,
  getRequestClaimsFromEvent,
  effectiveCollectionRole,
  getClientIp,
  requestIdentity,
} = require('../src/layers/base/base');

describe('Base Layer Tests', () => {
  describe('sendResponse', () => {
    it('should create a successful response', () => {
      const response = sendResponse(200, { items: [1, 2, 3] }, 'Success', null, null);
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        code: 200,
        data: { items: [1, 2, 3] },
        msg: 'Success',
        error: null,
        serverTime: expect.any(Number)
      });
    });

    it('should create an error response', () => {
      const error = sendResponse(400, [], 'Error', { error: 'error' }, { invokedFunctionArn: 'arn' });
      expect(error.statusCode).toBe(400);
      expect(JSON.parse(error.body)).toEqual({
        code: 400,
        data: [],
        msg: 'Error',
        error: null,
        serverTime: expect.any(Number)
      });
    });

    it('should include additional fields in response body', () => {
      const response = sendResponse(200, {}, 'Success', null, null, { other1: 1, other2: 2 });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.other1).toBe(1);
      expect(body.other2).toBe(2);
    });

    it('should carry server time close to now', () => {
      // The client corrects its own clock against this, so a stale or absent
      // value would silently reintroduce the skew it exists to remove.
      const before = Date.now();
      const body = JSON.parse(sendResponse(200, {}, 'Success', null, null).body);
      expect(typeof body.serverTime).toBe('number');
      expect(body.serverTime).toBeGreaterThanOrEqual(before);
      expect(body.serverTime).toBeLessThanOrEqual(Date.now());
    });

    it('should carry server time on an error response too', () => {
      const body = JSON.parse(sendResponse(400, [], 'Error', { error: 'e' }, null).body);
      expect(typeof body.serverTime).toBe('number');
    });

    it('should include CORS headers', () => {
      const response = sendResponse(200, {}, 'Success', null, null);
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,GET,POST,PUT');
      expect(response.headers['Access-Control-Allow-Credentials']).toBe(true);
    });
  });

  describe('checkWarmup', () => {
    it('should return false for events without warmup', () => {
      expect(checkWarmup({})).toBe(false);
    });

    it('should return false when warmup is false', () => {
      expect(checkWarmup({ warmup: false })).toBe(false);
    });

    it('should return true when warmup is true', () => {
      expect(checkWarmup({ warmup: true })).toBe(true);
    });
  });

  describe('Exception', () => {
    it('should create an exception with message and code', () => {
      const ex = new Exception('Test error', { code: 404 });
      expect(ex.message).toBe('Test error');
      expect(ex.code).toBe(404);
    });

    it('should create an exception with data', () => {
      const ex = new Exception('Test error', { code: 400, data: { field: 'value' } });
      expect(ex.message).toBe('Test error');
      expect(ex.code).toBe(400);
      expect(ex.data).toEqual({ field: 'value' });
    });
  });

  describe('getRequestClaimsFromEvent', () => {
    it('should extract claims from authenticated authorizer context', () => {
      const event = {
        requestContext: {
          authorizer: {
            isAuthenticated: true,
            claims: {
              sub: 'user123',
              email: 'test@example.com'
            }
          }
        }
      };
      const claims = getRequestClaimsFromEvent(event);
      expect(claims.sub).toBe('user123');
      expect(claims.email).toBe('test@example.com');
    });

    it('should return null when authorizer indicates unauthenticated', () => {
      const event = {
        requestContext: {
          authorizer: {
            isAuthenticated: false
          }
        }
      };
      const claims = getRequestClaimsFromEvent(event);
      expect(claims).toBeNull();
    });

    it('should return null when authorizer is missing', () => {
      const event = {
        requestContext: {}
      };
      const claims = getRequestClaimsFromEvent(event);
      expect(claims).toBeNull();
    });

    it('should return null when requestContext is missing', () => {
      const event = {};
      const claims = getRequestClaimsFromEvent(event);
      expect(claims).toBeNull();
    });

    it('should construct claims from new context format', () => {
      const event = {
        requestContext: {
          authorizer: {
            isAuthenticated: true,
            userId: 'user456',
            email: 'user@example.com',
            username: 'testuser'
          }
        }
      };
      const claims = getRequestClaimsFromEvent(event);
      expect(claims.sub).toBe('user456');
      expect(claims.email).toBe('user@example.com');
      expect(claims.username).toBe('testuser');
    });
  });

  describe('effectiveCollectionRole', () => {
    it('returns superadmin when permissions has the superadmin marker', () => {
      const ctx = { permissions: { superadmin: 'superadmin', 'bcparks_1': 'staff' } };
      expect(effectiveCollectionRole(ctx, 'bcparks_1')).toBe('superadmin');
    });

    it('returns the per-collection role for non-superadmins', () => {
      const ctx = { permissions: { 'bcparks_1': 'staff', 'bcparks_2': 'limited' } };
      expect(effectiveCollectionRole(ctx, 'bcparks_1')).toBe('staff');
      expect(effectiveCollectionRole(ctx, 'bcparks_2')).toBe('limited');
    });

    it('falls back to default when collection is not in permissions', () => {
      const ctx = { permissions: { 'bcparks_1': 'staff' } };
      expect(effectiveCollectionRole(ctx, 'bcparks_99')).toBe('default');
    });

    it('handles missing authContext or permissions gracefully', () => {
      expect(effectiveCollectionRole(null, 'bcparks_1')).toBe('default');
      expect(effectiveCollectionRole({}, 'bcparks_1')).toBe('default');
      expect(effectiveCollectionRole({ permissions: {} }, 'bcparks_1')).toBe('default');
    });
  });

  describe('getClientIp', () => {
    it('strips the port from an IPv4 CloudFront-Viewer-Address', () => {
      expect(getClientIp({ 'CloudFront-Viewer-Address': '203.0.113.7:54321' })).toBe('203.0.113.7');
    });

    it('strips the brackets and port from an IPv6 CloudFront-Viewer-Address', () => {
      expect(getClientIp({ 'CloudFront-Viewer-Address': '[2001:db8::1]:54321' })).toBe('2001:db8::1');
    });

    it('returns the raw value when there is no port', () => {
      expect(getClientIp({ 'CloudFront-Viewer-Address': '203.0.113.7' })).toBe('203.0.113.7');
    });

    it('returns null when the header is missing', () => {
      expect(getClientIp({})).toBeNull();
      expect(getClientIp(undefined)).toBeNull();
    });
  });

  describe('requestIdentity', () => {
    it('includes clientIp alongside the API Gateway source IP', () => {
      const event = {
        requestContext: {
          requestId: 'req-1',
          identity: { sourceIp: '10.0.0.1', userAgent: 'test-agent' },
          httpMethod: 'POST',
          path: '/bookings',
        },
        headers: { 'CloudFront-Viewer-Address': '198.51.100.9:1234' },
      };
      expect(requestIdentity(event)).toEqual(
        expect.objectContaining({
          ip: '10.0.0.1',
          clientIp: '198.51.100.9',
        })
      );
    });

    it('sets clientIp to null when the header is absent', () => {
      const event = { requestContext: {} };
      expect(requestIdentity(event).clientIp).toBeNull();
    });
  });
});
