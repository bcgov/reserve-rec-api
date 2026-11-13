const { createHash } = require('crypto');

const mockDdbSend = jest.fn();
const mockCognitoSend = jest.fn();
const mockGetOneByGlobalId = jest.fn();
const mockSendMigrationConfirmationEmail = jest.fn();
const mockLogger = { error: jest.fn() };

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDdbSend })),
  UpdateItemCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  AdminUpdateUserAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('/opt/base', () => {
  class Exception extends Error {
    constructor(message, options = {}) {
      super(message);
      this.code = options.code;
      this.data = options.data;
      this.error = options.error;
    }
  }
  return {
    Exception,
    logger: mockLogger,
    sendResponse: (statusCode, data, message) => ({ statusCode, data, message }),
  };
});
jest.mock('/opt/dynamodb', () => ({
  getOneByGlobalId: mockGetOneByGlobalId,
  TRANSACTIONAL_DATA_TABLE_NAME: 'transactional-data',
}));
jest.mock('/opt/emailBlocklist', () => ({
  canonicalizeEmail: (email) => email.trim().toLowerCase(),
}));
jest.mock('../../../../lib/handlers/emailDispatch/utils', () => ({
  sendMigrationConfirmationEmail: mockSendMigrationConfirmationEmail,
}));

process.env.CLAIM_TABLE_NAME = 'email-claims';
process.env.PUBLIC_USER_POOL_ID = 'public-user-pool';
process.env.PUBLIC_FRONTEND_DOMAIN = 'reserve.example.test/dayuse';

const { handler: sendEmail } = require('../POST/sendEmail');
const { handler: confirmMigration } = require('../POST/confirm');

const MIGRATE_ID = '4e707c5a-68f1-4728-b09e-2b5b691b86e6';
const TOKEN = 'a'.repeat(43);

function makeHold(overrides = {}) {
  return {
    pk: 'migrateHold',
    sk: 'bcsc-user',
    globalId: MIGRATE_ID,
    status: 'pending',
    holdExpiry: Date.now() + 60_000,
    oldParksUsername: 'parks@example.test',
    oldParksEmail: 'Parks@Example.Test',
    ...overrides,
  };
}

describe('migration email confirmation handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockCognitoSend.mockResolvedValue({});
    mockSendMigrationConfirmationEmail.mockResolvedValue({});
  });

  it('sends a one-time email only for the authenticated BC Parks account', async () => {
    mockGetOneByGlobalId.mockResolvedValue(makeHold());

    const response = await sendEmail({
      pathParameters: { migrateId: MIGRATE_ID },
      requestContext: { authorizer: { isAuthenticated: 'true', username: 'parks@example.test' } },
    });

    expect(response.statusCode).toBe(200);
    const update = mockDdbSend.mock.calls[0][0].input;
    expect(update.TableName).toBe('transactional-data');
    expect(update.ExpressionAttributeNames['#tokenHash']).toBe('emailConfirmationTokenHash');
    expect(mockSendMigrationConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'Parks@Example.Test',
      migrateId: MIGRATE_ID,
      confirmationUrl: expect.stringMatching(/^https:\/\/reserve\.example\.test\/dayuse\/migration-confirm#/),
    }));
    const { confirmationUrl } = mockSendMigrationConfirmationEmail.mock.calls[0][0];
    expect(confirmationUrl).toContain('token=');
  });

  it('rejects a user who does not own the BC Parks account on the hold', async () => {
    mockGetOneByGlobalId.mockResolvedValue(makeHold());

    const response = await sendEmail({
      pathParameters: { migrateId: MIGRATE_ID },
      requestContext: { authorizer: { isAuthenticated: 'true', username: 'someone-else' } },
    });

    expect(response.statusCode).toBe(403);
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockSendMigrationConfirmationEmail).not.toHaveBeenCalled();
  });

  it('confirms the hold with the token and clears claim and Cognito pending state', async () => {
    mockGetOneByGlobalId.mockResolvedValue(makeHold({
      emailConfirmationTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
      emailConfirmationExpiresAt: Date.now() + 60_000,
    }));

    const response = await confirmMigration({
      body: JSON.stringify({ migrateId: MIGRATE_ID, token: TOKEN }),
    });

    expect(response.statusCode).toBe(200);
    const updates = mockDdbSend.mock.calls.map(([command]) => command.input);
    expect(updates[0].ExpressionAttributeNames['#status']).toBe('status');
    expect(updates[1]).toMatchObject({
      TableName: 'email-claims',
      Key: { pk: { S: 'parks@example.test' } },
      ExpressionAttributeValues: { ':false': { BOOL: false } },
    });
    expect(mockCognitoSend.mock.calls[0][0].input).toMatchObject({
      UserPoolId: 'public-user-pool',
      Username: 'parks@example.test',
      UserAttributes: [
        { Name: 'custom:migrationPending', Value: 'false' },
        { Name: 'custom:migrationId', Value: 'none' },
      ],
    });
    expect(updates[2].UpdateExpression).toContain('REMOVE');
  });

  it('rejects a token that does not match the stored hash', async () => {
    mockGetOneByGlobalId.mockResolvedValue(makeHold({
      emailConfirmationTokenHash: createHash('sha256').update('b'.repeat(43)).digest('hex'),
      emailConfirmationExpiresAt: Date.now() + 60_000,
    }));

    const response = await confirmMigration({
      body: JSON.stringify({ migrateId: MIGRATE_ID, token: TOKEN }),
    });

    expect(response.statusCode).toBe(400);
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('returns success for an already-confirmed and fully finalized hold', async () => {
    mockGetOneByGlobalId.mockResolvedValue(makeHold({
      status: 'confirmed',
      emailConfirmationTokenHash: undefined,
    }));

    const response = await confirmMigration({
      body: JSON.stringify({ migrateId: MIGRATE_ID, token: TOKEN }),
    });

    expect(response.statusCode).toBe(200);
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });
});
