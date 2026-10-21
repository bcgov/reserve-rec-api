const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('/opt/base', () => ({ logger: mockLogger }));
jest.mock('/opt/dynamodb', () => ({ getOne: jest.fn() }));

const { validateToken } = require('../src/handlers/authorizers/methods');

describe('validateToken', () => {
  test('rethrows the verifier error and logs its name', async () => {
    const expired = Object.assign(new Error('Token expired at 2026-10-20T21:30:00.000Z'), { name: 'JwtExpiredError' });
    const verifier = { verify: jest.fn().mockRejectedValue(expired) };

    await expect(validateToken(verifier, 'token')).rejects.toBe(expired);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('JwtExpiredError'));
  });

  test('returns the payload of a valid token', async () => {
    const verifier = { verify: jest.fn().mockResolvedValue({ sub: 'abc' }) };
    await expect(validateToken(verifier, 'token')).resolves.toEqual({ sub: 'abc' });
  });
});
