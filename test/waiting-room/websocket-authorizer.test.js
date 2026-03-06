'use strict';

jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// aws-jwt-verify is only in lib/handlers/authorizer/node_modules, not root — use virtual mock
const mockVerify = jest.fn();
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify: mockVerify })),
  },
}), { virtual: true });

const { CognitoJwtVerifier } = require('aws-jwt-verify');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PUBLIC_USER_POOL_ID = 'us-east-1_TestPool';
  process.env.PUBLIC_USER_POOL_CLIENT_ID = 'test-client-id';
});

afterEach(() => {
  delete process.env.PUBLIC_USER_POOL_ID;
  delete process.env.PUBLIC_USER_POOL_CLIENT_ID;
});

const { handler } = require('../../src/handlers/waiting-room/websocket/authorizer');

const makeEvent = (overrides = {}) => ({
  methodArn: 'arn:aws:execute-api:ca-central-1:123456789:abc123/prod/$connect',
  queryStringParameters: {
    token: 'valid-jwt-token',
    queueId: 'QUEUE#golden-ears#camping#standard#2025-06-15',
    ...overrides.queryStringParameters,
  },
  ...overrides,
});

describe('WebSocket Lambda authorizer', () => {
  it('returns ALLOW policy with cognitoSub and queueId when token is valid', async () => {
    mockVerify.mockResolvedValue({ sub: 'user-sub-123' });

    const result = await handler(makeEvent());

    expect(result.principalId).toBe('user-sub-123');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.policyDocument.Statement[0].Action).toBe('execute-api:Invoke');
    expect(result.context.cognitoSub).toBe('user-sub-123');
    expect(result.context.queueId).toBe('QUEUE#golden-ears#camping#standard#2025-06-15');
  });

  it('throws Unauthorized when no token provided', async () => {
    const event = makeEvent({ queryStringParameters: { queueId: 'QUEUE#x' } });
    await expect(handler(event)).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized when no queueId provided', async () => {
    const event = makeEvent({ queryStringParameters: { token: 'some-token' } });
    await expect(handler(event)).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized when user pool env vars are missing', async () => {
    delete process.env.PUBLIC_USER_POOL_ID;
    await expect(handler(makeEvent())).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized when PUBLIC_USER_POOL_CLIENT_ID is missing', async () => {
    delete process.env.PUBLIC_USER_POOL_CLIENT_ID;
    await expect(handler(makeEvent())).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized when JWT verification fails', async () => {
    mockVerify.mockRejectedValue(new Error('Token is expired'));
    await expect(handler(makeEvent())).rejects.toThrow('Unauthorized');
  });

  it('creates verifier with correct pool and client config', async () => {
    mockVerify.mockResolvedValue({ sub: 'user-abc' });

    await handler(makeEvent());

    expect(CognitoJwtVerifier.create).toHaveBeenCalledWith({
      userPoolId: 'us-east-1_TestPool',
      tokenUse: 'access',
      clientId: 'test-client-id',
    });
  });
});
