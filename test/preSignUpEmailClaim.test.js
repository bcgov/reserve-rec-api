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
const mockDdbSend = jest.fn(async ({ input }) => {
  const existing = mockClaims.get(input.Item.pk.S);
  const holds = input.ConditionExpression.split(' OR ').some((term) => (
    term === 'attribute_not_exists(pk)'
      ? !existing
      : existing?.email === input.ExpressionAttributeValues[term.split(' = ')[1]].S
  ));
  if (!holds) {
    throw Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
      Item: { email: { S: existing.email } },
    });
  }
  mockClaims.set(input.Item.pk.S, { email: input.Item.email.S });
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
  return { Username: input.Username, UserStatus: 'UNCONFIRMED' };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  ...jest.requireActual('@aws-sdk/client-cognito-identity-provider'),
  CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args) => mockCognitoSend(...args) })),
}));

const { logger } = require('/opt/base');
const { handler } = require('../lib/handlers/cognitoTriggers/preSignUp');

const signUp = (email, triggerSource = 'PreSignUp_SignUp') => ({
  userPoolId: 'pool',
  triggerSource,
  callerContext: { clientId: 'client-1' },
  request: { userAttributes: { email } },
});

// An existing account holding the mailbox under `address`.
function existingAccount(canonical, address = canonical) {
  mockClaims.set(canonical, { email: address });
  mockUsers.add(address);
}

const refused = expect.objectContaining({ signupRefused: true });
const logged = (event) => logger.info.mock.calls.filter(([msg]) => msg === event).map(([, fields]) => fields);

describe('PreSignUp mailbox claim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaims.clear();
    mockUsers.clear();
    process.env.DUPLICATE_EMAIL_REFUSE = 'true';
  });

  it('claims a new mailbox under its canonical form', async () => {
    await expect(handler(signUp('Me+Parks@Example.test'))).resolves.toBeDefined();
    expect(mockClaims.get('me@example.test')).toEqual({ email: 'me+parks@example.test' });
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('refuses a plus-tag of a live account', async () => {
    existingAccount('me@example.test');
    await expect(handler(signUp('me+1@example.test'))).rejects.toEqual(refused);
    expect(mockClaims.get('me@example.test')).toEqual({ email: 'me@example.test' });
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

  it('logs a duplicate refusal with the domain and caller, never the local part', async () => {
    existingAccount('someone@example.test');
    await handler(signUp('someone+1@example.test')).catch(() => {});
    const [fields] = logged('event=signup_refused');
    expect(fields).toEqual({
      reason: 'duplicate',
      domain: 'example.test',
      clientId: 'client-1',
      triggerSource: 'PreSignUp_SignUp',
    });
    expect(JSON.stringify(fields)).not.toContain('someone');
  });

  it('allows the same address in another case, as a retry of the same signup', async () => {
    existingAccount('me@example.test');
    await expect(handler(signUp('ME@Example.TEST'))).resolves.toBeDefined();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('takes over a claim whose holder no longer exists', async () => {
    mockClaims.set('me@example.test', { email: 'me+gone@example.test' });
    await expect(handler(signUp('me+new@example.test'))).resolves.toBeDefined();
    expect(mockClaims.get('me@example.test')).toEqual({ email: 'me+new@example.test' });
  });

  it('refuses when a concurrent signup takes the stale claim first', async () => {
    mockClaims.set('me@example.test', { email: 'me+gone@example.test' });
    mockCognitoSend.mockImplementationOnce(async () => {
      mockClaims.set('me@example.test', { email: 'me+racer@example.test' });
      throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
    });
    await expect(handler(signUp('me+new@example.test'))).rejects.toEqual(refused);
    expect(mockClaims.get('me@example.test')).toEqual({ email: 'me+racer@example.test' });
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

  it('logs but allows a duplicate with the kill switch off, and keeps the live claim', async () => {
    process.env.DUPLICATE_EMAIL_REFUSE = 'false';
    existingAccount('me@example.test');
    await expect(handler(signUp('me+1@example.test'))).resolves.toBeDefined();
    expect(logged('event=signup_duplicate')).toEqual([
      { domain: 'example.test', clientId: 'client-1', triggerSource: 'PreSignUp_SignUp' },
    ]);
    expect(logged('event=signup_refused')).toEqual([]);
    expect(mockClaims.get('me@example.test')).toEqual({ email: 'me@example.test' });
  });

  it('refuses a blocked address on the blocklist before any claim is written', async () => {
    await expect(handler(signUp(BANNED))).rejects.toEqual(refused);
    expect(logged('event=signup_refused')).toEqual([expect.objectContaining({ reason: 'address' })]);
    expect(mockDdbSend).not.toHaveBeenCalled();
  });
});
