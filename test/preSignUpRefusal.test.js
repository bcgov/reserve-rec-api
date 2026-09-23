// The handler's refusal path: what propagates, what fails open, and what the
// caller is told.

jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const mockLoadBlocklist = jest.fn();
const mockRefusalReason = jest.fn();
jest.mock('/opt/emailBlocklist', () => ({
  loadBlocklist: (...args) => mockLoadBlocklist(...args),
  refusalReason: (...args) => mockRefusalReason(...args),
  emailDomain: (email) => String(email).split('@')[1] || null,
  // The mailbox claim is covered in preSignUpEmailClaim.test.js.
  canonicalizeEmail: () => null,
}));

jest.mock('/opt/phone', () => ({ isValidPhoneNumber: () => true }));

const { handler } = require('../lib/handlers/cognitoTriggers/preSignUp');

const event = (email = 'someone@example.test') => ({
  userPoolId: 'pool',
  triggerSource: 'PreSignUp_SignUp',
  request: { userAttributes: { email } },
});

describe('PreSignUp refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadBlocklist.mockResolvedValue({ addresses: new Set(), domains: [], patterns: [] });
    mockRefusalReason.mockReturnValue(null);
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

  it('records the domain and caller, never the local part', async () => {
    const { logger } = require('/opt/base');
    mockRefusalReason.mockReturnValue('domain');
    await handler({
      ...event('someone@blocked.test'),
      callerContext: { clientId: 'client-1' },
    }).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields).toMatchObject({
      reason: 'domain',
      domain: 'blocked.test',
      clientId: 'client-1',
      triggerSource: 'PreSignUp_SignUp',
    });
    expect(JSON.stringify(fields)).not.toContain('someone');
  });

  // A federated refusal creates no user and CloudTrail redacts the attributes,
  // so without the provider id there is no way back to the account.
  it('names the provider identity on a federated refusal', async () => {
    const { logger } = require('/opt/base');
    mockRefusalReason.mockReturnValue('address');
    await handler({
      ...event('someone@blocked.test'),
      triggerSource: 'PreSignUp_ExternalProvider',
      userName: 'BCSC_a1b2c3d4',
    }).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields).toMatchObject({ reason: 'address', identity: 'BCSC_a1b2c3d4' });
  });

  it('leaves identity off a native signup, which has no provider', async () => {
    const { logger } = require('/opt/base');
    mockRefusalReason.mockReturnValue('address');
    await handler({ ...event('someone@blocked.test'), userName: 'ignored' }).catch(() => {});

    const [, fields] = logger.info.mock.calls.find(([msg]) => msg === 'event=signup_refused');
    expect(fields).not.toHaveProperty('identity');
  });

  it('fails open when the blocklist cannot be read', async () => {
    mockLoadBlocklist.mockRejectedValue(new Error('DynamoDB unavailable'));
    await expect(handler(event())).resolves.toBeDefined();
  });
});
