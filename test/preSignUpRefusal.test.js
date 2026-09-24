// The handler's refusal path: what propagates, what fails open, and what the
// caller is told.

jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const mockLoadBlocklist = jest.fn();
const mockRefusalReason = jest.fn();
const mockCanonicalizeEmail = jest.fn();
jest.mock('/opt/emailBlocklist', () => ({
  loadBlocklist: (...args) => mockLoadBlocklist(...args),
  refusalReason: (...args) => mockRefusalReason(...args),
  emailDomain: (email) => String(email).split('@')[1] || null,
  canonicalizeEmail: (...args) => mockCanonicalizeEmail(...args),
}));

const mockIsValidPhoneNumber = jest.fn();
jest.mock('/opt/phone', () => ({ isValidPhoneNumber: (...args) => mockIsValidPhoneNumber(...args) }));

process.env.REFUSAL_TABLE_NAME = 'refusals';
const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (...args) => mockDdbSend(...args) })),
}));

const { handler } = require('../lib/handlers/cognitoTriggers/preSignUp');

const event = (email = 'someone@example.test') => ({
  userPoolId: 'pool',
  triggerSource: 'PreSignUp_SignUp',
  request: { userAttributes: { email } },
});

describe('PreSignUp refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockLoadBlocklist.mockResolvedValue({ addresses: new Set(), domains: [], patterns: [] });
    mockRefusalReason.mockReturnValue(null);
    mockIsValidPhoneNumber.mockReturnValue(true);
    // Null keeps the mailbox claim out of scope here; it is covered in
    // preSignUpEmailClaim.test.js. A refusal test opts in where it needs one.
    mockCanonicalizeEmail.mockReturnValue(null);
  });

  it('allows an address the blocklist does not match', async () => {
    await expect(handler(event())).resolves.toBeDefined();
  });

  it('refuses a matched address', async () => {
    mockRefusalReason.mockReturnValue('domain');
    await expect(handler(event())).rejects.toThrow(/could not complete your registration/i);
  });

  // The refusal reaches the caller, so it must not name the attribute or the
  // rule that matched.
  it('says nothing about which rule matched', async () => {
    mockRefusalReason.mockReturnValue('pattern');
    await expect(handler(event())).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/email|address|domain|pattern|blocked|banned/i),
      })
    );
  });

  // Regression guard: the refusal used to be recognised by its message text, so
  // rewording it turned every refusal into a fail-open.
  it('still refuses when the message is not what the catch expects', async () => {
    mockRefusalReason.mockReturnValue('address');
    const err = await handler(event()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.signupRefused).toBe(true);
  });

  it('records the account and caller on a refusal', async () => {
    const { logger } = require('/opt/base');
    mockRefusalReason.mockReturnValue('domain');
    mockCanonicalizeEmail.mockReturnValue('someone@blocked.test');
    await handler({
      ...event('someone@blocked.test'),
      callerContext: { clientId: 'client-1' },
    }).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields).toEqual({
      reason: 'domain',
      domain: 'blocked.test',
      clientId: 'client-1',
      triggerSource: 'PreSignUp_SignUp',
      localPart: 'someone',
    });
  });

  // The canonical form, so a plus-tag or dotted variant records as one account.
  it('records the canonical local part, not the address as typed', async () => {
    const { logger } = require('/opt/base');
    mockRefusalReason.mockReturnValue('address');
    mockCanonicalizeEmail.mockReturnValue('someone@blocked.test');
    await handler(event('Some.One+parks@Blocked.test')).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields.localPart).toBe('someone');
  });

  // A federated refusal creates no user and CloudTrail redacts the attributes,
  // so without the provider id there is no way back to the account.
  it('names the provider identity on a federated refusal', async () => {
    const { logger } = require('/opt/base');
    mockIsValidPhoneNumber.mockReturnValue(false);
    await handler({
      ...event('someone@example.test'),
      triggerSource: 'PreSignUp_ExternalProvider',
      userName: 'bcsc_a1b2c3d4',
      request: { userAttributes: { email: 'someone@example.test', 'custom:mobilePhone': '123' } },
    }).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields).toMatchObject({ reason: 'phone', identity: 'bcsc_a1b2c3d4' });
  });

  describe('BCSC sign-in', () => {
    const federated = (userName = 'bcsc_a1b2c3d4') => ({
      ...event('someone@blocked.test'),
      triggerSource: 'PreSignUp_ExternalProvider',
      userName,
    });

    it('passes and logs signup_flagged', async () => {
      const { logger } = require('/opt/base');
      mockRefusalReason.mockReturnValue('pattern');
      await expect(handler(federated())).resolves.toBeDefined();

      const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_flagged');
      expect(fields).toMatchObject({ reason: 'pattern', identity: 'bcsc_a1b2c3d4' });
      expect(logger.info.mock.calls.map(([msg]) => msg)).not.toContain('event=signup_refused');
      expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it('leaves a native sign-up unchanged', async () => {
      mockRefusalReason.mockReturnValue('pattern');
      await expect(handler(event('someone@blocked.test'))).rejects.toThrow(expect.objectContaining({ signupRefused: true }));
    });

    it('leaves another provider unchanged', async () => {
      mockRefusalReason.mockReturnValue('pattern');
      await expect(handler(federated('google_a1b2c3d4'))).rejects.toThrow(expect.objectContaining({ signupRefused: true }));
    });

    it('leaves the phone check unchanged', async () => {
      mockRefusalReason.mockReturnValue('pattern');
      mockIsValidPhoneNumber.mockReturnValue(false);
      const signup = federated();
      signup.request.userAttributes['custom:mobilePhone'] = '123';
      await expect(handler(signup)).rejects.toThrow(expect.objectContaining({ signupRefused: true }));
    });
  });

  it('leaves identity off a native signup, which has no provider', async () => {
    const { logger } = require('/opt/base');
    mockRefusalReason.mockReturnValue('address');
    await handler({ ...event('someone@blocked.test'), userName: 'ignored' }).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields).not.toHaveProperty('identity');
  });

  describe('refusal record', () => {
    const bcsc = () => ({
      ...event('someone@blocked.test'),
      triggerSource: 'PreSignUp_ExternalProvider',
      userName: 'bcsc_a1b2c3d4',
      request: {
        userAttributes: {
          email: 'someone@blocked.test',
          given_name: 'Test',
          family_name: 'User',
          address: '{"formatted":"1 Example St"}',
          'custom:mobilePhone': '123',
        },
      },
    });
    const writes = () => mockDdbSend.mock.calls.map(([cmd]) => cmd.input);

    it('records who a refused BCSC sign-in was, without the address', async () => {
      mockIsValidPhoneNumber.mockReturnValue(false);
      const before = Math.floor(Date.now() / 1000);
      await expect(handler(bcsc())).rejects.toThrow(expect.objectContaining({ signupRefused: true }));

      const [{ TableName, Item }] = writes();
      expect(TableName).toBe('refusals');
      expect(Item).toEqual({
        pk: { S: 'bcsc_a1b2c3d4' },
        sk: { S: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
        givenName: { S: 'Test' },
        familyName: { S: 'User' },
        email: { S: 'someone@blocked.test' },
        reason: { S: 'phone' },
        expiresAt: { N: expect.any(String) },
      });
      const ttl = Number(Item.expiresAt.N) - before;
      expect(ttl).toBeGreaterThanOrEqual(90 * 86400);
      expect(ttl).toBeLessThan(90 * 86400 + 60);
    });

    it('records nothing for a native refusal', async () => {
      mockRefusalReason.mockReturnValue('address');
      await expect(handler(event('someone@blocked.test'))).rejects.toThrow();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it('records nothing for an allowed BCSC sign-in', async () => {
      await expect(handler(bcsc())).resolves.toBeDefined();
      expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it('still refuses when the record cannot be written', async () => {
      const { logger } = require('/opt/base');
      mockIsValidPhoneNumber.mockReturnValue(false);
      mockDdbSend.mockRejectedValue(new Error('DynamoDB unavailable'));
      await expect(handler(bcsc())).rejects.toThrow(expect.objectContaining({ signupRefused: true }));
      expect(logger.error).toHaveBeenCalledWith('PreSignUp refusal record failed', { error: 'DynamoDB unavailable' });
    });
  });

  it('fails open when the blocklist cannot be read', async () => {
    mockLoadBlocklist.mockRejectedValue(new Error('DynamoDB unavailable'));
    await expect(handler(event())).resolves.toBeDefined();
  });
});
