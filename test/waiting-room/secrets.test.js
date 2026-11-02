'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  ...jest.requireActual('@aws-sdk/client-secrets-manager'),
  SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
}));

const secrets = require('../../src/handlers/waiting-room/utils/secrets');

describe('waiting-room secrets', () => {
  beforeEach(() => {
    secrets._clearCache();
    mockSend.mockReset().mockResolvedValue({ SecretString: 'k-1' });
    delete process.env.HMAC_SIGNING_KEY_ARN;
  });

  it('fetches a secret once per ARN and serves repeats from cache', async () => {
    await expect(secrets.getSecret('arn:a')).resolves.toBe('k-1');
    await expect(secrets.getSecret('arn:a')).resolves.toBe('k-1');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual({ SecretId: 'arn:a' });

    mockSend.mockResolvedValue({ SecretString: 'k-2' });
    await expect(secrets.getSecret('arn:b')).resolves.toBe('k-2');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed fetch', async () => {
    mockSend.mockRejectedValueOnce(new Error('denied'));
    await expect(secrets.getSecret('arn:a')).rejects.toThrow('denied');
    await expect(secrets.getSecret('arn:a')).resolves.toBe('k-1');
  });

  it('reads the HMAC key from the configured ARN', async () => {
    process.env.HMAC_SIGNING_KEY_ARN = 'arn:hmac';
    await expect(secrets.getHmacSigningKey()).resolves.toBe('k-1');
    expect(mockSend.mock.calls[0][0].input).toEqual({ SecretId: 'arn:hmac' });
  });

  it('refuses to sign without an HMAC key ARN', async () => {
    await expect(secrets.getHmacSigningKey()).rejects.toThrow('HMAC_SIGNING_KEY_ARN environment variable not set');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
