const {
  sendResponse,
  checkWarmup,
  Exception,
  getRequestClaimsFromEvent,
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
        context: null
      });
    });

    it('should create an error response', () => {
      const error = sendResponse(400, [], 'Error', { error: 'error' }, null);
      expect(error.statusCode).toBe(400);
      expect(JSON.parse(error.body)).toEqual({
        code: 400,
        data: [],
        msg: 'Error',
        error: { error: 'error' },
        context: null
      });
    });

    it('should include additional fields in response body', () => {
      const response = sendResponse(200, {}, 'Success', null, null, { other1: 1, other2: 2 });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.other1).toBe(1);
      expect(body.other2).toBe(2);
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
});
