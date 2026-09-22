const { requestIdentity } = require('../src/layers/base/base');

const event = (authorizer, identity = {}) => ({
  requestContext: {
    requestId: 'req-1',
    httpMethod: 'GET',
    path: '/api/bookings',
    authorizer,
    identity: { sourceIp: '1.2.3.4', userAgent: 'agent/1', ...identity },
  },
  headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig' },
});

describe('requestIdentity', () => {
  it('returns the authenticated caller', () => {
    expect(requestIdentity(event({ userId: 'sub-123', isAuthenticated: 'true' }))).toEqual({
      requestId: 'req-1',
      userId: 'sub-123',
      authenticated: true,
      ip: '1.2.3.4',
      userAgent: 'agent/1',
      httpMethod: 'GET',
      path: '/api/bookings',
    });
  });

  it('reports a guest as having no userId', () => {
    const id = requestIdentity(event({ userId: 'guest', isAuthenticated: 'false' }));
    expect(id.userId).toBeNull();
    expect(id.authenticated).toBe(false);
    expect(id.ip).toBe('1.2.3.4');
  });

  // The whole point of the helper: it is the thing handlers log, so it must
  // never carry the bearer token or contact details the raw event holds.
  it('carries no credentials or contact details', () => {
    const id = requestIdentity(event({
      userId: 'sub-123',
      isAuthenticated: 'true',
      email: 'someone@example.com',
      username: 'someone',
    }));
    const serialized = JSON.stringify(id);
    expect(serialized).not.toMatch(/Bearer|eyJ/);
    expect(serialized).not.toMatch(/example\.com|someone/);
    expect(Object.keys(id).sort()).toEqual(
      ['authenticated', 'httpMethod', 'ip', 'path', 'requestId', 'userAgent', 'userId']
    );
  });

  it('does not throw on an event with no request context', () => {
    expect(requestIdentity({})).toEqual({
      requestId: null, userId: null, authenticated: false, ip: null,
      userAgent: null, httpMethod: null, path: null,
    });
    expect(() => requestIdentity(undefined)).not.toThrow();
  });
});
