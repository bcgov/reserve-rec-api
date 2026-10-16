// The real layer write against an in-memory item, so the test covers what
// reaches DynamoDB rather than what the handler passes to a mock.
const mockStore = new Map();
const mockSent = [];
const mockAfterRead = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  const { marshall, unmarshall } = jest.requireActual('@aws-sdk/util-dynamodb');
  const keyOf = (key) => `${key.pk.S}|${key.sk.S}`;
  const send = async (command) => {
    mockSent.push(command);
    const { input } = command;
    if (command instanceof actual.GetItemCommand) {
      const item = mockStore.get(keyOf(input.Key));
      mockAfterRead();
      return item ? { Item: marshall(item) } : {};
    }
    if (command instanceof actual.UpdateItemCommand) {
      const item = mockStore.get(keyOf(input.Key));
      const values = unmarshall(input.ExpressionAttributeValues);
      for (const term of input.UpdateExpression.replace(/^SET /, '').split(', ')) {
        const [name, value] = term.split(' = ');
        item[input.ExpressionAttributeNames[name]] = values[value];
      }
      return {};
    }
    if (command instanceof actual.PutItemCommand) {
      mockStore.set(keyOf(input.Item), unmarshall(input.Item));
      return {};
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  };
  return { ...actual, DynamoDBClient: jest.fn(() => ({ send })) };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: jest.fn() })),
  AdminUpdateUserAttributesCommand: jest.fn(),
}));

process.env.TRANSACTIONAL_DATA_TABLE_NAME = 'table';
const { UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { handler } = require('../lib/handlers/cognitoTriggers/postConfirmation');

const SUB = '11111111-2222-3333-4444-555555555555';
const KEY = `user|${SUB}`;
const REVIEW = { state: 'rejected', source: 'banned', matchedOn: 'phone', at: '2026-06-01T00:00:00.000Z' };

const event = () => ({
  userPoolId: 'pool',
  userName: SUB,
  request: { userAttributes: { sub: SUB, email: 'person@example.test', email_verified: 'true' } },
});

describe('PreTokenGeneration user write', () => {
  beforeEach(() => {
    mockStore.clear();
    mockSent.length = 0;
    mockAfterRead.mockReset();
    mockStore.set(KEY, {
      pk: 'user', sk: SUB, email: 'person@example.test', enabled: false, createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('keeps a review written between its read and its write', async () => {
    mockAfterRead.mockImplementation(() => { mockStore.get(KEY).review = REVIEW; });
    await handler(event());

    const [update] = mockSent.filter((c) => c instanceof UpdateItemCommand);
    expect(Object.values(update?.input.ExpressionAttributeNames ?? {}).filter((n) => n.startsWith('review'))).toEqual([]);
    expect(mockStore.get(KEY).review).toEqual(REVIEW);
  });

  it('updates the login fields and leaves enabled and createdAt as stored', async () => {
    await handler(event());

    expect(mockStore.get(KEY)).toMatchObject({
      enabled: false, createdAt: '2026-01-01T00:00:00.000Z', userStatus: 'CONFIRMED', lastLogin: expect.any(String),
    });
    const [update] = mockSent.filter((c) => c instanceof UpdateItemCommand);
    expect(update.input.ConditionExpression).toBe('attribute_exists(pk) AND attribute_exists(sk)');
  });
});
