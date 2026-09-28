jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getNow: () => ({ toISO: () => '2026-01-01T00:00:00.000Z' }),
}));
jest.mock('/opt/dynamodb', () => ({
  TRANSACTIONAL_DATA_TABLE_NAME: 'table',
  putItem: jest.fn(),
  updateItem: jest.fn(),
  getOne: jest.fn(),
}));
jest.mock('/opt/emailBlocklist', () => {
  const real = jest.requireActual('/opt/emailBlocklist');
  return {
    canonicalizeEmail: real.canonicalizeEmail,
    refusalReason: real.refusalReason,
    loadBlocklist: jest.fn(),
  };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: jest.fn() })),
  AdminUpdateUserAttributesCommand: jest.fn(),
}));

const { logger } = require('/opt/base');
const { getOne, updateItem, putItem } = require('/opt/dynamodb');
const { loadBlocklist, canonicalizeEmail } = require('/opt/emailBlocklist');
const { handler } = require('../lib/handlers/cognitoTriggers/postConfirmation');

const SUB = '11111111-2222-3333-4444-555555555555';

// Synthetic list, same shapes as the seed.
const blocklist = {
  addresses: new Set(['banned@example.com'].map(canonicalizeEmail)),
  domains: ['blocked.example'],
  patterns: [],
};

function event(email, { bcsc = false, emailVerified = 'true' } = {}) {
  const userAttributes = { sub: SUB, email, email_verified: emailVerified };
  if (bcsc) userAttributes.identities = JSON.stringify([{ providerName: 'BCSC' }]);
  return {
    userPoolId: 'pool',
    triggerSource: 'TokenGeneration_Authentication',
    userName: bcsc ? `BCSC_${SUB}` : SUB,
    request: { userAttributes },
  };
}

const existing = (email) => ({ pk: 'user', sk: SUB, email, enabled: true, createdAt: '2025-01-01T00:00:00.000Z' });

const infoEvents = () => logger.info.mock.calls.map(([msg]) => msg).filter((m) => String(m).startsWith('event='));

describe('PreTokenGeneration email change detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EMAIL_CHANGE_REFUSE;
    process.env.BLOCKLIST_TABLE_NAME = 'blocklist';
    loadBlocklist.mockResolvedValue(blocklist);
  });

  it('does not report a change when the email is unchanged', async () => {
    getOne.mockResolvedValue(existing('person@example.com'));
    await expect(handler(event('person@example.com'))).resolves.toBeDefined();
    expect(infoEvents()).not.toContain('event=email_changed');
    expect(loadBlocklist).not.toHaveBeenCalled();
    expect(updateItem).toHaveBeenCalledTimes(1);
  });

  it('treats a plus-tag or Gmail dot variant as the same address', async () => {
    getOne.mockResolvedValue(existing('p.e.r.s.o.n@gmail.com'));
    await handler(event('person+tag@gmail.com'));
    expect(infoEvents()).not.toContain('event=email_changed');
  });

  it('does not compare when the record has no email on file', async () => {
    getOne.mockResolvedValue(existing(''));
    await handler(event('person@example.com'));
    expect(infoEvents()).not.toContain('event=email_changed');
  });

  it('does not compare on first login', async () => {
    getOne.mockResolvedValue(null);
    await handler(event('person@example.com'));
    expect(infoEvents()).toContain('event=account_created');
    expect(infoEvents()).not.toContain('event=email_changed');
    expect(putItem).toHaveBeenCalledTimes(1);
  });

  it('logs email_changed for a clean native change and stores the new address', async () => {
    getOne.mockResolvedValue(existing('old@example.com'));
    await expect(handler(event('new@example.com'))).resolves.toBeDefined();

    expect(logger.info).toHaveBeenCalledWith('event=email_changed', { sub: SUB, source: 'native' });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(updateItem).toHaveBeenCalledWith(
      expect.objectContaining({ sk: SUB, email: 'new@example.com' }),
      'table',
    );
  });

  it('logs the source as bcsc for a federated account', async () => {
    getOne.mockResolvedValue(existing('old@example.com'));
    await handler(event('new@example.com', { bcsc: true }));
    expect(logger.info).toHaveBeenCalledWith('event=email_changed', { sub: SUB, source: 'bcsc' });
  });

  it('never logs the address value', async () => {
    getOne.mockResolvedValue(existing('old@example.com'));
    await handler(event('banned@example.com'));
    for (const level of ['info', 'warn']) {
      for (const call of logger[level].mock.calls) {
        expect(JSON.stringify(call)).not.toMatch(/@example\.com/);
      }
    }
  });

  it('logs email_change_refused but does not throw while refusal is off', async () => {
    getOne.mockResolvedValue(existing('old@example.com'));
    await expect(handler(event('banned+tag@example.com'))).resolves.toBeDefined();

    expect(logger.warn).toHaveBeenCalledWith('event=email_change_refused', { sub: SUB, source: 'native', reason: 'address' });
    // Still stored: the next login compares against the current address.
    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({ email: 'banned+tag@example.com' }), 'table');
  });

  it('throws for a native account when refusal is on', async () => {
    process.env.EMAIL_CHANGE_REFUSE = 'true';
    getOne.mockResolvedValue(existing('old@example.com'));
    await expect(handler(event('anyone@blocked.example')))
      .rejects.toThrow('This account cannot be used. Contact support if you believe this is an error.');
    expect(logger.warn).toHaveBeenCalledWith('event=email_change_refused', { sub: SUB, source: 'native', reason: 'domain' });
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('passes a BCSC email change', async () => {
    process.env.EMAIL_CHANGE_REFUSE = 'true';
    getOne.mockResolvedValue(existing('old@example.com'));
    await expect(handler(event('banned@example.com', { bcsc: true }))).resolves.toBeDefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('fails open when the list cannot be loaded', async () => {
    process.env.EMAIL_CHANGE_REFUSE = 'true';
    loadBlocklist.mockRejectedValue(new Error('SSM unavailable'));
    getOne.mockResolvedValue(existing('old@example.com'));

    await expect(handler(event('banned@example.com'))).resolves.toBeDefined();
    expect(logger.info).toHaveBeenCalledWith('event=email_changed', { sub: SUB, source: 'native' });
    expect(logger.error).toHaveBeenCalledWith('PreTokenGeneration blocklist check failed open', { error: 'SSM unavailable' });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(updateItem).toHaveBeenCalledTimes(1);
  });
});

describe('PreTokenGeneration review fields', () => {
  const flagged = { reviewFlag: true, reviewReason: 'address', reviewFlaggedAt: '2026-01-01T00:00:00.000Z' };
  const stored = () => (putItem.mock.calls[0] || updateItem.mock.calls[0])[0];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EMAIL_CHANGE_REFUSE;
    process.env.BLOCKLIST_TABLE_NAME = 'blocklist';
    loadBlocklist.mockResolvedValue(blocklist);
  });

  it('sets review fields on a matching BCSC first login', async () => {
    getOne.mockResolvedValue(null);
    await handler(event('banned@example.com', { bcsc: true }));
    expect(stored()).toMatchObject(flagged);
    expect(logger.info).toHaveBeenCalledWith('event=account_flagged', { sub: SUB, reason: 'address' });
  });

  it('sets review fields on an existing BCSC account that matches', async () => {
    getOne.mockResolvedValue(existing('anyone@blocked.example'));
    await handler(event('anyone@blocked.example', { bcsc: true }));
    expect(stored()).toMatchObject({ ...flagged, reviewReason: 'domain' });
  });

  it('sets none on a non-matching BCSC account', async () => {
    getOne.mockResolvedValue(null);
    await handler(event('person@example.com', { bcsc: true }));
    expect(stored()).not.toHaveProperty('reviewFlag');
  });

  it('sets none on a native account', async () => {
    getOne.mockResolvedValue(null);
    await handler(event('banned@example.com'));
    expect(stored()).not.toHaveProperty('reviewFlag');
  });

  it('keeps review fields across logins', async () => {
    getOne.mockResolvedValue({ ...existing('banned@example.com'), ...flagged, reviewedBy: 'admin' });
    await handler(event('banned@example.com', { bcsc: true }));
    expect(loadBlocklist).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ ...flagged, reviewedBy: 'admin' });
  });

  it('keeps a cleared reviewFlag while the address is unchanged', async () => {
    getOne.mockResolvedValue({ ...existing('banned@example.com'), ...flagged, reviewFlag: false });
    await handler(event('banned@example.com', { bcsc: true }));
    expect(stored().reviewFlag).toBe(false);
  });

  it('sets reviewFlag again after an address change', async () => {
    getOne.mockResolvedValue({ ...existing('old@example.com'), ...flagged, reviewFlag: false });
    await handler(event('anyone@blocked.example', { bcsc: true }));
    expect(stored()).toMatchObject({ reviewFlag: true, reviewReason: 'domain' });
  });

  it('logs in when the check cannot run', async () => {
    loadBlocklist.mockRejectedValue(new Error('unavailable'));
    getOne.mockResolvedValue(null);
    await expect(handler(event('banned@example.com', { bcsc: true }))).resolves.toBeDefined();
    expect(stored()).not.toHaveProperty('reviewFlag');
    expect(putItem).toHaveBeenCalledTimes(1);
  });
});
