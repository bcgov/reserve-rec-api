// One account per mailbox: the claim PreSignUp writes against the canonical
// form of the address, and what it does when the mailbox is already held.

process.env.CLAIM_TABLE_NAME = 'claims';

jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const BANNED = 'banned@example.test';
jest.mock('/opt/dynamodb', () => ({
  runQuery: jest.fn().mockResolvedValue({
    items: [{ kind: 'address', value: 'banned@example.test' }],
  }),
}));

// An in-memory claim table that evaluates the handler's condition expression,
// so the tests exercise the conditions rather than a scripted reply.
const mockClaims = new Map();
let mockHoldReads = [];
let mockHoldPutError;
const mockDdbSend = jest.fn(async ({ input }) => {
  // Refusal records go to their own table and are covered in preSignUpRefusal.test.js.
  if (input.TableName !== 'claims') {
    if (input.Key?.pk?.S === 'migrateHold') {
      const result = mockHoldReads.shift();
      if (result instanceof Error) throw result;
      return result || {};
    }
    if (input.Item?.pk?.S === 'migrateHold' && mockHoldPutError) {
      throw mockHoldPutError;
    }
    return {};
  }
  const existing = mockClaims.get(input.Item.pk.S);
  const holds = input.ConditionExpression.split(' OR ').some((term) => {
    if (term === 'attribute_not_exists(pk)') return !existing;
    if (term.includes('attribute_not_exists(#owner)')) {
      return !existing?.owner
        && existing?.email === input.ExpressionAttributeValues[':staleEmail'].S;
    }
    const valueName = term.split(' = ')[1]?.replace(/[()]/g, '');
    return existing?.owner === input.ExpressionAttributeValues[valueName]?.S;
  });
  if (!holds) {
    throw Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
      Item: {
        ...(existing.email && { email: { S: existing.email } }),
        ...(existing.owner && { owner: { S: existing.owner } }),
        ...(existing.source && { source: { S: existing.source } }),
      },
    });
  }
  mockClaims.set(input.Item.pk.S, {
    email: input.Item.email.S,
    owner: input.Item.owner.S,
    source: input.Item.source.S,
  });
  return {};
});
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (...args) => mockDdbSend(...args) })),
}));

const mockUsers = new Set();
const mockCognitoSend = jest.fn(async ({ input }) => {
  if (!mockUsers.has(input.Username)) {
    throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
  }
  return {
    Username: input.Username,
    UserStatus: 'UNCONFIRMED',
    UserAttributes: [{ Name: 'sub', Value: `sub-${input.Username}` }],
  };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  ...jest.requireActual('@aws-sdk/client-cognito-identity-provider'),
  CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args) => mockCognitoSend(...args) })),
}));

const { logger } = require('/opt/base');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { handler } = require('../lib/handlers/cognitoTriggers/preSignUp');
const { FORM_ATTRIBUTES } = require('./helpers/preSignUpForm');

const signUp = (email, triggerSource = 'PreSignUp_SignUp') => ({
  userPoolId: 'pool',
  userName: email,
  triggerSource,
  callerContext: { clientId: 'client-1' },
  request: { userAttributes: { email, ...FORM_ATTRIBUTES } },
});

// An existing account holding the mailbox under `address`.
function existingAccount(canonical, address = canonical) {
  mockClaims.set(canonical, { email: address, owner: address, source: 'bcparks' });
  mockUsers.add(address);
}

const refused = expect.objectContaining({ signupRefused: true });
const logged = (event) => logger.info.mock.calls.filter(([msg]) => msg === event).map(([, fields]) => fields);

describe('PreSignUp mailbox claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaims.clear();
    mockUsers.clear();
    mockHoldReads = [];
    mockHoldPutError = undefined;
    process.env.DUPLICATE_EMAIL_REFUSE = 'true';
  });

  it('claims a new mailbox under its canonical form', async () => {
    await expect(handler(signUp('Me+Parks@Example.test'))).resolves.toBeDefined();
    expect(mockClaims.get('me@example.test')).toEqual({
      email: 'me+parks@example.test',
      owner: 'Me+Parks@Example.test',
      source: 'bcparks',
    });
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('refuses a plus-tag of a live account', async () => {
    existingAccount('me@example.test');
    await expect(handler(signUp('me+1@example.test'))).rejects.toEqual(refused);
    expect(mockClaims.get('me@example.test')).toEqual({
      email: 'me@example.test',
      owner: 'me@example.test',
      source: 'bcparks',
    });
  });

  it('uses the BCSC-specific duplicate message when a BCSC account holds the claim', async () => {
    mockClaims.set('me@example.test', {
      email: 'me@example.test',
      owner: 'bcsc_12345',
      source: 'bcsc',
    });
    mockUsers.add('bcsc_12345');

    await expect(handler(signUp('me+1@example.test'))).rejects.toMatchObject({
      message: expect.stringContaining('BC Services Card (BCSC)'),
    });
  });

  it('refuses a Gmail dot variant', async () => {
    existingAccount('someone@gmail.com');
    await expect(handler(signUp('some.one@googlemail.com'))).rejects.toEqual(refused);
  });

  it('refuses while the holder is still unconfirmed', async () => {
    // The mock reports every existing user as UNCONFIRMED.
    existingAccount('me@example.test', 'me+first@example.test');
    await expect(handler(signUp('me@example.test', 'PreSignUp_AdminCreateUser'))).rejects.toEqual(refused);
  });

  it('logs a duplicate refusal against the canonical address, not the tagged one', async () => {
    existingAccount('someone@example.test');
    await handler(signUp('someone+1@example.test')).catch(() => {});
    const [fields] = logged('event=signup_refused');
    expect(fields).toEqual({
      reason: 'duplicate',
      domain: 'example.test',
      clientId: 'client-1',
      triggerSource: 'PreSignUp_SignUp',
      localPart: 'someone',
    });
  });

  it('allows the same address in another case, as a retry of the same signup', async () => {
    existingAccount('me@example.test');
    await expect(handler(signUp('ME@Example.TEST'))).resolves.toBeDefined();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('refuses another account with the same exact email and source', async () => {
    existingAccount('me@example.test');
    const event = signUp('me@example.test');
    event.userName = 'different-cognito-user';

    await expect(handler(event)).rejects.toEqual(refused);
    expect(mockClaims.get('me@example.test').owner).toBe('me@example.test');
  });

  it('creates a migration hold and refuses BCSC signup when a native account owns the mailbox', async () => {
    existingAccount('me@example.test');
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({
      signupRefused: true,
      message: expect.stringMatching(/A BC Parks account .*exists\.\$BCPARKS_MIGRATION_REQUIRED:[0-9a-f-]{36}$/i),
    });

    const holdWrite = mockDdbSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.TableName !== 'claims' && input.Item?.pk?.S === 'migrateHold');
    expect(holdWrite.Item.status.S).toBe('pending');
    expect(holdWrite.Item.globalId.S).toMatch(/^[0-9a-f-]{36}$/i);
    expect(holdWrite.Item.oldParksSub.S).toBe('sub-me@example.test');
    expect(holdWrite.Item.oldParksUsername.S).toBe('me@example.test');
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ Username: 'me@example.test' }),
    }));
  });

  it('recognizes legacy BC Parks claims without owner or source fields', async () => {
    mockClaims.set('me@example.test', { email: 'me@example.test' });
    mockUsers.add('me@example.test');
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({
      message: expect.stringContaining('$BCPARKS_MIGRATION_REQUIRED:'),
    });

    const holdWrite = mockDdbSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.Item?.pk?.S === 'migrateHold');
    expect(holdWrite.Item.oldParksUsername.S).toBe('me@example.test');
    expect(holdWrite.Item.oldParksSub.S).toBe('sub-me@example.test');
  });

  it('takes over a legacy claim when its BC Parks account no longer exists', async () => {
    mockClaims.set('me@example.test', { email: 'me@example.test' });
    const event = signUp('me@example.test');
    event.userName = 'new-cognito-user';

    await expect(handler(event)).resolves.toBeDefined();

    expect(mockClaims.get('me@example.test')).toMatchObject({
      owner: 'new-cognito-user',
      source: 'bcparks',
    });
  });

  it('still prompts BCSC account migration when duplicate refusals are disabled', async () => {
    process.env.DUPLICATE_EMAIL_REFUSE = 'false';
    existingAccount('me@example.test');
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({
      signupRefused: true,
      message: expect.stringContaining('$BCPARKS_MIGRATION_REQUIRED:'),
    });
    expect(mockDdbSend.mock.calls.some(([command]) => (
      command.input.Item?.pk?.S === 'migrateHold'
    ))).toBe(true);
  });

  it('refuses to create a migration hold when the existing Cognito user has no sub', async () => {
    existingAccount('me@example.test');
    mockCognitoSend.mockResolvedValueOnce({ UserAttributes: [] });
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({ signupRefused: true });
    expect(logger.error).toHaveBeenCalledWith('BC Parks account is missing its Cognito sub');
    expect(mockDdbSend.mock.calls.some(([command]) => command.input.Item?.pk?.S === 'migrateHold')).toBe(false);
  });

  it('refuses BCSC signup when the migration hold cannot be read', async () => {
    existingAccount('me@example.test');
    mockHoldReads = [new Error('hold table unavailable')];
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({ signupRefused: true });
    expect(logger.error).toHaveBeenCalledWith(
      'Migration hold lookup failed',
      { error: 'hold table unavailable' },
    );
  });

  it('refuses BCSC signup when a migration hold cannot be created', async () => {
    existingAccount('me@example.test');
    mockHoldPutError = new Error('hold write failed');
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({ signupRefused: true });
    expect(logger.error).toHaveBeenCalledWith(
      'Migration hold creation failed',
      { error: 'hold write failed' },
    );
  });

  it('reuses a concurrently-created pending migration hold', async () => {
    existingAccount('me@example.test');
    mockHoldPutError = Object.assign(new Error('conditional failure'), {
      name: 'ConditionalCheckFailedException',
    });
    mockHoldReads = [
      {},
      {
        Item: marshall({
          pk: 'migrateHold',
          sk: 'bcsc_12345',
          status: 'pending',
          holdExpiry: Date.now() + 60_000,
          globalId: '4e707c5a-68f1-4728-b09e-2b5b691b86e6',
        }),
      },
    ];
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({
      message: expect.stringContaining('$BCPARKS_MIGRATION_REQUIRED:4e707c5a-68f1-4728-b09e-2b5b691b86e6'),
    });
  });

  it('replaces a pending migration hold with no expiry', async () => {
    existingAccount('me@example.test');
    mockHoldReads = [{
      Item: marshall({
        pk: 'migrateHold',
        sk: 'bcsc_12345',
        status: 'pending',
        globalId: 'stale-id',
      }),
    }];
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({
      message: expect.stringMatching(/\$BCPARKS_MIGRATION_REQUIRED:[0-9a-f-]{36}$/i),
    });

    const holdWrite = mockDdbSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.Item?.pk?.S === 'migrateHold');
    expect(holdWrite.Item.globalId.S).not.toBe('stale-id');
    expect(holdWrite.ConditionExpression)
      .toContain('attribute_not_exists(#holdExpiry)');
  });

  it('refuses when a concurrent migration hold cannot be recovered', async () => {
    existingAccount('me@example.test');
    mockHoldPutError = Object.assign(new Error('conditional failure'), {
      name: 'ConditionalCheckFailedException',
    });
    mockHoldReads = [{}, new Error('hold recovery read failed')];
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({ signupRefused: true });
    expect(logger.error).toHaveBeenCalledWith(
      'Migration hold recovery lookup failed',
      { error: 'hold recovery read failed' },
    );
  });

  it('refuses when a concurrent hold is not a reusable pending migration', async () => {
    existingAccount('me@example.test');
    mockHoldPutError = Object.assign(new Error('conditional failure'), {
      name: 'ConditionalCheckFailedException',
    });
    mockHoldReads = [
      {},
      {
        Item: marshall({
          pk: 'migrateHold',
          sk: 'bcsc_12345',
          status: 'completed',
          holdExpiry: Date.now() + 60_000,
          globalId: 'completed-id',
        }),
      },
    ];
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({ signupRefused: true });
    expect(logger.error).not.toHaveBeenCalledWith(
      'Migration hold recovery lookup failed',
      expect.any(Object),
    );
  });

  it('reuses pending holds and lets confirmed or completed migration signups proceed', async () => {
    existingAccount('me@example.test');
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';
    const pendingHold = {
      pk: 'migrateHold',
      sk: 'bcsc_12345',
      status: 'pending',
      holdExpiry: Date.now() + 60_000,
      globalId: '4e707c5a-68f1-4728-b09e-2b5b691b86e6',
    };

    mockHoldReads = [{ Item: marshall(pendingHold) }];
    await expect(handler(event)).rejects.toMatchObject({
      message: expect.stringContaining('$BCPARKS_MIGRATION_REQUIRED:4e707c5a-68f1-4728-b09e-2b5b691b86e6'),
    });

    mockHoldReads = [{ Item: marshall({ ...pendingHold, status: 'confirmed' }) }];
    await expect(handler(event)).resolves.toBe(event);

    mockHoldReads = [{ Item: marshall({ ...pendingHold, status: 'completed' }) }];
    await expect(handler(event)).resolves.toBe(event);
  });

  it('replaces an expired pending migration hold with a fresh prompt', async () => {
    existingAccount('me@example.test');
    mockHoldReads = [{
      Item: marshall({
        pk: 'migrateHold',
        sk: 'bcsc_12345',
        status: 'pending',
        holdExpiry: Date.now() - 1,
        globalId: 'expired-id',
      }),
    }];
    const event = signUp('me@example.test', 'PreSignUp_ExternalProvider');
    event.userName = 'bcsc_12345';

    await expect(handler(event)).rejects.toMatchObject({
      signupRefused: true,
      message: expect.not.stringContaining('expired-id'),
    });
    const holdWrite = mockDdbSend.mock.calls
      .map(([command]) => command.input)
      .find((input) => input.Item?.pk?.S === 'migrateHold');
    expect(holdWrite.ConditionExpression).toContain('#holdExpiry <= :now');
  });

  it('takes over a claim whose holder no longer exists', async () => {
    mockClaims.set('me@example.test', {
      email: 'me+gone@example.test',
      owner: 'gone-user',
      source: 'bcparks',
    });
    await expect(handler(signUp('me+new@example.test'))).resolves.toBeDefined();
    expect(mockClaims.get('me@example.test')).toEqual({
      email: 'me+new@example.test',
      owner: 'me+new@example.test',
      source: 'bcparks',
    });
  });

  it('refuses when a concurrent signup takes the stale claim first', async () => {
    mockClaims.set('me@example.test', { email: 'me+gone@example.test' });
    mockCognitoSend.mockImplementationOnce(async () => {
      mockClaims.set('me@example.test', {
        email: 'me+racer@example.test',
        owner: 'racer-user',
        source: 'bcparks',
      });
      throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
    });
    await expect(handler(signUp('me+new@example.test'))).rejects.toEqual(refused);
    expect(mockClaims.get('me@example.test')).toEqual({
      email: 'me+racer@example.test',
      owner: 'racer-user',
      source: 'bcparks',
    });
  });

  it('leaves federated signups alone', async () => {
    existingAccount('me@example.test');
    await expect(handler(signUp('me+1@example.test', 'PreSignUp_ExternalProvider'))).resolves.toBeDefined();
    expect(mockDdbSend).not.toHaveBeenCalled();
  });

  it('fails open when DynamoDB is unavailable', async () => {
    mockDdbSend.mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    await expect(handler(signUp('me@example.test'))).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalledWith('PreSignUp mailbox claim failed open', { error: 'throttled' });
  });

  it('fails open when the holder cannot be looked up', async () => {
    existingAccount('me@example.test');
    mockCognitoSend.mockRejectedValueOnce(Object.assign(new Error('slow down'), { name: 'TooManyRequestsException' }));
    await expect(handler(signUp('me+1@example.test'))).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalledWith('PreSignUp mailbox claim failed open', { error: 'slow down' });
  });

  it.each([['false'], ['unset']])('logs but allows a duplicate with DUPLICATE_EMAIL_REFUSE %s, and keeps the live claim', async (value) => {
    if (value === 'unset') delete process.env.DUPLICATE_EMAIL_REFUSE;
    else process.env.DUPLICATE_EMAIL_REFUSE = value;
    existingAccount('me@example.test');
    await expect(handler(signUp('me+1@example.test'))).resolves.toBeDefined();
    expect(logged('event=signup_duplicate')).toEqual([
      { domain: 'example.test', clientId: 'client-1', triggerSource: 'PreSignUp_SignUp' },
    ]);
    expect(logged('event=signup_refused')).toEqual([]);
    expect(mockClaims.get('me@example.test')).toEqual({
      email: 'me@example.test',
      owner: 'me@example.test',
      source: 'bcparks',
    });
  });

  it('refuses a blocked address on the blocklist before any claim is written', async () => {
    await expect(handler(signUp(BANNED))).rejects.toEqual(refused);
    expect(logged('event=signup_refused')).toEqual([expect.objectContaining({ reason: 'address' })]);
    expect(mockDdbSend.mock.calls.filter(([{ input }]) => input.TableName === 'claims')).toEqual([]);
  });
});
