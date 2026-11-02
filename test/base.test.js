const {
  sendResponse,
  checkWarmup,
  Exception,
  getRequestClaimsFromEvent,
  effectiveCollectionRole,
  filterByRole,
  checkAuthContext,
  getClientIp,
  requestIdentity,
  meetsTier,
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

    it('should send Retry-After, readable cross-origin, on a 503 that carries a hint', () => {
      const response = sendResponse(503, { retryAfter: 2 }, 'Busy', null, null);
      expect(response.headers['Retry-After']).toBe('2');
      expect(response.headers['Access-Control-Expose-Headers']).toBe('Retry-After');
      expect(JSON.parse(response.body).data).toEqual({ retryAfter: 2 });
    });

    it('should not send Retry-After on other statuses', () => {
      const response = sendResponse(400, { retryAfter: 2 }, 'Refused', null, null);
      expect(response.headers['Retry-After']).toBeUndefined();
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
    it('treats a collection value other than limited or staff as default', () => {
      expect(effectiveCollectionRole({ permissions: { bcparks_1: 'superadmin' } }, 'bcparks_1')).toBe('default');
      expect(effectiveCollectionRole({ permissions: { bcparks_1: 'constructor' } }, 'bcparks_1')).toBe('default');
    });

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

  describe('filterByRole', () => {
    const FILTERS = { default: ['adminNotes', 'version'], staff: ['adminNotes'] };
    const row = { id: 1, adminNotes: 'n', version: 2 };

    it('filters each item of a paginated list result', () => {
      const res = { items: [row, row], lastEvaluatedKey: { pk: 'x' } };
      expect(filterByRole(res, 'default', FILTERS)).toEqual({
        items: [{ id: 1 }, { id: 1 }],
        lastEvaluatedKey: { pk: 'x' },
      });
      expect(filterByRole(res, 'staff', FILTERS).items).toEqual([{ id: 1, version: 2 }, { id: 1, version: 2 }]);
    });

    it('still filters a single item and a plain array', () => {
      expect(filterByRole(row, 'default', FILTERS)).toEqual({ id: 1 });
      expect(filterByRole([row], 'default', FILTERS)).toEqual([{ id: 1 }]);
    });

    it('returns a list unchanged to a superadmin', () => {
      const res = { items: [row] };
      expect(filterByRole(res, 'superadmin', FILTERS)).toBe(res);
    });
  });

  describe('checkAuthContext', () => {
    const eventWith = (permissions, pathParameters) => ({
      pathParameters,
      requestContext: {
        authorizer: { principalId: 'user1', permissions: JSON.stringify(permissions) },
      },
    });

    it('lets a staff-only user pass a limited requirement', () => {
      const ctx = checkAuthContext(eventWith({ bcparks_1: 'staff' }), 'limited');
      expect(ctx.sub).toBe('user1');
    });

    it('lets a limited-only user pass a limited requirement', () => {
      expect(() => checkAuthContext(eventWith({ bcparks_1: 'limited' }), 'limited')).not.toThrow();
    });

    it('lets a staff user pass a limited requirement for their collection', () => {
      const event = eventWith({ bcparks_1: 'staff' }, { collectionId: 'bcparks_1' });
      expect(() => checkAuthContext(event, 'limited')).not.toThrow();
    });

    it('refuses a limited-only user on a staff requirement', () => {
      expect(() => checkAuthContext(eventWith({ bcparks_1: 'limited' }), 'staff')).toThrow(
        expect.objectContaining({ code: 403 }),
      );
      const event = eventWith({ bcparks_1: 'limited' }, { collectionId: 'bcparks_1' });
      expect(() => checkAuthContext(event, 'staff')).toThrow(expect.objectContaining({ code: 403 }));
    });

    it('refuses a user with no tier', () => {
      expect(() => checkAuthContext(eventWith({}), 'limited')).toThrow(
        expect.objectContaining({ code: 403 }),
      );
    });

    it('refuses an unrecognised tier', () => {
      expect(() => checkAuthContext(eventWith({ bcparks_1: 'bogus' }), 'limited')).toThrow(
        expect.objectContaining({ code: 403 }),
      );
    });

    it('refuses a staff user on a superadmin requirement', () => {
      expect(() => checkAuthContext(eventWith({ bcparks_1: 'staff' }), 'superadmin')).toThrow(
        expect.objectContaining({ code: 403 }),
      );
    });

    it('refuses a superadmin value held without the superadmin key', () => {
      expect(() => checkAuthContext(eventWith({ bcparks_1: 'superadmin' }), 'superadmin')).toThrow(
        expect.objectContaining({ code: 403 }),
      );
    });

    it('checks only the requested collection, not the user\'s other collections', () => {
      const event = eventWith({ a: 'staff', b: 'limited' }, { collectionId: 'b' });
      expect(() => checkAuthContext(event, 'staff')).toThrow(expect.objectContaining({ code: 403 }));
    });

    it('lets a superadmin pass any requirement', () => {
      const permissions = { superadmin: 'superadmin' };
      for (const tier of ['limited', 'staff', 'superadmin']) {
        expect(() => checkAuthContext(eventWith(permissions), tier)).not.toThrow();
        expect(() => checkAuthContext(eventWith(permissions, { collectionId: 'bcparks_1' }), tier)).not.toThrow();
      }
    });
  });

  describe('meetsTier', () => {
    it('ranks limited below staff and never admits superadmin as a held or required tier', () => {
      expect(meetsTier('staff', 'limited')).toBe(true);
      expect(meetsTier('limited', 'staff')).toBe(false);
      expect(meetsTier('superadmin', 'superadmin')).toBe(false);
      expect(meetsTier('superadmin', 'limited')).toBe(false);
      expect(meetsTier('staff', 'superadmin')).toBe(false);
      expect(meetsTier('constructor', 'limited')).toBe(false);
      expect(meetsTier('staff', '__proto__')).toBe(false);
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
