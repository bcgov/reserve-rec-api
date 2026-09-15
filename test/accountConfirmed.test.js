jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('/opt/base');
const { handler } = require('../lib/handlers/cognitoTriggers/accountConfirmed');

const event = (triggerSource, userName = 'a-b-c-d') => ({
  triggerSource,
  userName,
  request: { userAttributes: { sub: 'sub-1', email: 'person@example.com' } },
  response: {},
});

describe('PostConfirmation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('logs a confirmed signup and returns the event untouched', async () => {
    const ev = event('PostConfirmation_ConfirmSignUp');
    await expect(handler(ev)).resolves.toBe(ev);
    expect(logger.info).toHaveBeenCalledWith('event=account_confirmed', { sub: 'sub-1', federated: false });
  });

  it('marks a federated confirmation', async () => {
    await handler(event('PostConfirmation_ConfirmSignUp', 'bcsc_abc123'));
    expect(logger.info).toHaveBeenCalledWith('event=account_confirmed', expect.objectContaining({ federated: true }));
  });

  it('does not count a forgotten-password confirmation as a signup', async () => {
    await handler(event('PostConfirmation_ConfirmForgotPassword'));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('never logs the address', async () => {
    await handler(event('PostConfirmation_ConfirmSignUp'));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('person@example.com');
  });

  it('fails open', async () => {
    await expect(handler(null)).resolves.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
