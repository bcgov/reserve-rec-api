const mockDdbSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDdbSend })),
  GetItemCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  AdminUpdateUserAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('/opt/base', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));
jest.mock('/opt/emailBlocklist', () => ({
  canonicalizeEmail: (email) => email.trim().toLowerCase(),
}));

process.env.CLAIM_TABLE_NAME = 'email-claims';
const { handler } = require('../lib/handlers/cognitoTriggers/postAuthentication');

describe('PostAuthentication migration state sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({
      Item: {
        owner: { S: 'parks@example.test' },
        source: { S: 'bcparks' },
        migrateHoldPending: { BOOL: true },
        migrateId: { S: '4e707c5a-68f1-4728-b09e-2b5b691b86e6' },
        migrateTargetName: { S: 'Test User' },
      },
    });
    mockCognitoSend.mockResolvedValue({});
  });

  it('sets migration attributes only for the BC Parks claim owner', async () => {
    const event = {
      triggerSource: 'PostAuthentication_Authentication',
      userPoolId: 'public-user-pool',
      userName: 'parks@example.test',
      request: { userAttributes: { email: ' Parks@Example.Test ' } },
    };

    await expect(handler(event)).resolves.toBe(event);

    expect(mockDdbSend.mock.calls[0][0].input).toMatchObject({
      TableName: 'email-claims',
      Key: { pk: { S: 'parks@example.test' } },
      ConsistentRead: true,
    });
    expect(mockCognitoSend.mock.calls[0][0].input).toMatchObject({
      UserPoolId: 'public-user-pool',
      Username: 'parks@example.test',
      UserAttributes: [
        { Name: 'custom:migrationPending', Value: 'true' },
        { Name: 'custom:migrationId', Value: '4e707c5a-68f1-4728-b09e-2b5b691b86e6' },
        { Name: 'custom:migrationTargetName', Value: 'Test User' },
      ],
    });
  });

  it('does not modify an account that does not own the BC Parks claim', async () => {
    mockDdbSend.mockResolvedValue({
      Item: {
        owner: { S: 'different-user' },
        source: { S: 'bcparks' },
        migrateHoldPending: { BOOL: true },
        migrateId: { S: '4e707c5a-68f1-4728-b09e-2b5b691b86e6' },
        migrateTargetName: { S: 'Test User' },
      },
    });

    await handler({
      triggerSource: 'PostAuthentication_Authentication',
      userPoolId: 'public-user-pool',
      userName: 'parks@example.test',
      request: { userAttributes: { email: 'parks@example.test' } },
    });

    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('does not update migration attributes when they already match the claim', async () => {
    const event = {
      triggerSource: 'PostAuthentication_Authentication',
      userPoolId: 'public-user-pool',
      userName: 'parks@example.test',
      request: {
        userAttributes: {
          email: 'parks@example.test',
          'custom:migrationPending': 'true',
          'custom:migrationId': '4e707c5a-68f1-4728-b09e-2b5b691b86e6',
          'custom:migrationTargetName': 'Test User',
        },
      },
    };

    await expect(handler(event)).resolves.toBe(event);

    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('updates only attributes that differ from the claim', async () => {
    const event = {
      triggerSource: 'PostAuthentication_Authentication',
      userPoolId: 'public-user-pool',
      userName: 'parks@example.test',
      request: {
        userAttributes: {
          email: 'parks@example.test',
          'custom:migrationPending': 'false',
          'custom:migrationId': '4e707c5a-68f1-4728-b09e-2b5b691b86e6',
          'custom:migrationTargetName': 'Test User',
        },
      },
    };

    await handler(event);

    expect(mockCognitoSend.mock.calls[0][0].input.UserAttributes).toEqual([
      { Name: 'custom:migrationPending', Value: 'true' },
    ]);
  });

  it.each([
    ['DynamoDB', () => mockDdbSend.mockRejectedValue(new Error('DynamoDB unavailable'))],
    ['Cognito', () => mockCognitoSend.mockRejectedValue(new Error('Cognito unavailable'))],
  ])('logs a %s error without blocking sign-in', async (_service, failRequest) => {
    const { logger } = require('/opt/base');
    failRequest();
    const event = {
      triggerSource: 'PostAuthentication_Authentication',
      userPoolId: 'public-user-pool',
      userName: 'parks@example.test',
      request: { userAttributes: { email: 'parks@example.test' } },
    };

    await expect(handler(event)).resolves.toBe(event);

    expect(logger.error).toHaveBeenCalledWith(
      'PostAuthentication migration state sync failed',
      { error: expect.stringMatching(/unavailable/) },
    );
  });
});
