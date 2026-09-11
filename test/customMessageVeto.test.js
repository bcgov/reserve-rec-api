jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('/opt/base');
const { handler } = require('../lib/handlers/cognitoTriggers/customMessage');

const SUB = '11111111-2222-3333-4444-555555555555';
const CLIENT = '1h57kf5cpq17m0eml12EXAMPLE';
const VETO_MESSAGE = 'Email address changes are not available. Contact support if you need to update your address.';

// The email on the event is the OLD address; the new one is not in the event.
function event(triggerSource, clientId = CLIENT) {
  return {
    version: '1',
    triggerSource,
    userPoolId: 'pool',
    userName: SUB,
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId },
    request: {
      userAttributes: { sub: SUB, email: 'old@example.com', email_verified: 'true' },
      codeParameter: '{####}',
      linkParameter: '{##Click Here##}',
      usernameParameter: null,
    },
    response: { smsMessage: null, emailMessage: null, emailSubject: null },
  };
}

const allLogged = () => JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);

describe('CustomMessage veto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EMAIL_CHANGE_VETO;
  });

  it.each([
    'CustomMessage_SignUp',
    'CustomMessage_AdminCreateUser',
    'CustomMessage_ResendCode',
    'CustomMessage_ForgotPassword',
    'CustomMessage_VerifyUserAttribute',
    'CustomMessage_Authentication',
  ])('passes %s through untouched', async (triggerSource) => {
    process.env.EMAIL_CHANGE_VETO = 'true';
    const input = event(triggerSource);
    const snapshot = JSON.stringify(input);
    const out = await handler(input);
    expect(out).toBe(input);
    expect(JSON.stringify(out)).toBe(snapshot);
    expect(out.response).toEqual({ smsMessage: null, emailMessage: null, emailSubject: null });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('observes a self-service change and returns the event while the veto is off', async () => {
    const input = event('CustomMessage_UpdateUserAttribute');
    await expect(handler(input)).resolves.toBe(input);
    expect(logger.info).toHaveBeenCalledWith('event=email_change_observed', { sub: SUB, source: 'self-service' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('observes an admin change while the veto is off', async () => {
    await handler(event('CustomMessage_UpdateUserAttribute', 'CLIENT_ID_NOT_APPLICABLE'));
    expect(logger.info).toHaveBeenCalledWith('event=email_change_observed', { sub: SUB, source: 'admin' });
  });

  it('vetoes a self-service change when the flag is on', async () => {
    process.env.EMAIL_CHANGE_VETO = 'true';
    await expect(handler(event('CustomMessage_UpdateUserAttribute'))).rejects.toThrow(VETO_MESSAGE);
    expect(logger.warn).toHaveBeenCalledWith('event=email_change_vetoed', { sub: SUB, clientId: CLIENT });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('lets an admin-initiated change through when the flag is on', async () => {
    process.env.EMAIL_CHANGE_VETO = 'true';
    const input = event('CustomMessage_UpdateUserAttribute', 'CLIENT_ID_NOT_APPLICABLE');
    await expect(handler(input)).resolves.toBe(input);
    expect(logger.info).toHaveBeenCalledWith('event=email_change_observed', { sub: SUB, source: 'admin' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not veto when callerContext is missing', async () => {
    process.env.EMAIL_CHANGE_VETO = 'true';
    const input = event('CustomMessage_UpdateUserAttribute');
    delete input.callerContext;
    await expect(handler(input)).resolves.toBe(input);
    expect(logger.info).toHaveBeenCalledWith('event=email_change_observed', { sub: SUB, source: 'admin' });
  });

  it('falls back to userName for the sub', async () => {
    const input = event('CustomMessage_UpdateUserAttribute');
    delete input.request.userAttributes.sub;
    await handler(input);
    expect(logger.info).toHaveBeenCalledWith('event=email_change_observed', { sub: SUB, source: 'self-service' });
  });

  it('fails open on a malformed event', async () => {
    process.env.EMAIL_CHANGE_VETO = 'true';
    const broken = { triggerSource: 'CustomMessage_UpdateUserAttribute' };
    Object.defineProperty(broken, 'request', { get() { throw new Error('bad shape'); } });
    await expect(handler(broken)).resolves.toBe(broken);
    expect(logger.error).toHaveBeenCalledWith('CustomMessage trigger failed open', { error: 'bad shape' });

    await expect(handler(undefined)).resolves.toBeUndefined();
    await expect(handler(null)).resolves.toBeNull();
  });

  it('never logs the address', async () => {
    process.env.EMAIL_CHANGE_VETO = 'true';
    await handler(event('CustomMessage_UpdateUserAttribute', 'CLIENT_ID_NOT_APPLICABLE'));
    await handler(event('CustomMessage_UpdateUserAttribute')).catch(() => {});
    delete process.env.EMAIL_CHANGE_VETO;
    await handler(event('CustomMessage_UpdateUserAttribute'));
    expect(allLogged()).not.toContain('@example.com');
    expect(allLogged()).not.toContain('old@');
  });
});
