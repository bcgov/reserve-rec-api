process.env.TRANSACTIONAL_DATA_TABLE_NAME = 'migration-transactions';
process.env.AUDIT_TABLE_NAME = 'migration-audit';

const mockDynamoSend = jest.fn();
const mockWriteAuditLog = jest.fn();

jest.mock('/opt/base', () => ({
  Exception: jest.fn(),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  writeAuditLog: (...args) => mockWriteAuditLog(...args),
}));

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn(() => ({ send: (...args) => mockDynamoSend(...args) })),
  };
});

const {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { migrateAccounts } = require('../src/layers/awsUtils/dynamodb');

describe('migrateAccounts', () => {
  const oldSub = 'old-sub';
  const newSub = 'new-sub';
  const sourceItems = [
    {
      pk: 'booking::old-sub',
      sk: 'old-sub::booking',
      userId: oldSub,
      gsipk: oldSub,
      bookingId: 'booking-1',
    },
    {
      pk: 'booking::booking-2',
      sk: 'booking-2',
      userId: oldSub,
      gsipk: oldSub,
      bookingId: 'booking-2',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return {};
      if (command instanceof QueryCommand) {
        return { Items: sourceItems.map((item) => marshall(item)) };
      }
      if (command instanceof TransactWriteItemsCommand) {
        return { $metadata: { httpStatusCode: 200 } };
      }
      throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
    });
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  it('moves keyed records and updates user indexes in one transaction with start and completion audit events', async () => {
    const rollback = await migrateAccounts(oldSub, newSub);

    const query = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof QueryCommand);
    const targetRead = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof GetItemCommand);
    const transaction = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteItemsCommand);
    expect(query).toBeInstanceOf(QueryCommand);
    expect(targetRead.input.ConsistentRead).toBe(true);
    expect(transaction).toBeInstanceOf(TransactWriteItemsCommand);
    expect(transaction.input.TransactItems).toHaveLength(3);
    expect(transaction.input.TransactItems[0].Put.Item.userId.S).toBe(newSub);
    expect(transaction.input.TransactItems[0].Put.Item.pk.S).toBe('booking::new-sub');
    expect(transaction.input.TransactItems[1].Delete.Key.pk.S).toBe('booking::old-sub');
    expect(transaction.input.TransactItems[2].Update.ExpressionAttributeValues[':newGsipk'].S).toBe(newSub);
    expect(transaction.input.TransactItems[2].Update.UpdateExpression).toBe('SET #userId = :newUserId, #gsipk = :newGsipk');
    expect(mockWriteAuditLog.mock.calls.map((call) => call[2])).toEqual([
      'ACCOUNT_MIGRATION_STARTED',
      'ACCOUNT_MIGRATION_COMPLETED',
    ]);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      'cognito',
      newSub,
      'ACCOUNT_MIGRATION_COMPLETED',
      expect.objectContaining({ oldSub, newSub, migratedItemCount: 2 }),
      expect.any(Function),
      expect.any(Function),
      'migration-audit',
      true,
    );
    expect(rollback).toEqual(expect.any(Function));
  });

  it('migrates records from every page of the userId index', async () => {
    const laterPageItem = {
      pk: 'booking::booking-3',
      sk: 'booking-3',
      userId: oldSub,
      bookingId: 'booking-3',
    };
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return {};
      if (command instanceof QueryCommand) {
        const queryCount = mockDynamoSend.mock.calls.filter(([call]) => (
          call instanceof QueryCommand
        )).length;
        if (queryCount === 1) {
          return {
            Items: sourceItems.map((item) => marshall(item)),
            // Give a fake lastEvaluatedKey for it to mock query again
            LastEvaluatedKey: marshall({ pk: 'page-1', sk: 'page-1' }),
          };
        }
        return { Items: [marshall(laterPageItem)] };
      }
      if (command instanceof TransactWriteItemsCommand) return {};
      throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
    });

    await migrateAccounts(oldSub, newSub);

    const queries = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof QueryCommand);
    const migration = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteItemsCommand);
    expect(queries).toHaveLength(2);
    expect(queries[1].input.ExclusiveStartKey).toEqual(marshall({ pk: 'page-1', sk: 'page-1' }));
    expect(migration.input.TransactItems).toHaveLength(4);
    expect(migration.input.TransactItems.some((operation) => (
      operation.Update?.Key.sk.S === 'booking-3'
      && operation.Update.ExpressionAttributeValues[':newUserId'].S === newSub
    ))).toBe(true);
  });

  it('returns a compensating rollback for a later migration-stage failure', async () => {
    const rollback = await migrateAccounts(oldSub, newSub);
    await rollback(new Error('attribute transfer failed'));

    const transactions = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof TransactWriteItemsCommand);
    expect(transactions).toHaveLength(2);
    expect(transactions[1].input.TransactItems[0].Delete.Key.pk.S).toBe('booking::new-sub');
    expect(transactions[1].input.TransactItems[1].Put.Item.pk.S).toBe('booking::old-sub');
    expect(transactions[1].input.TransactItems[2].Update.UpdateExpression)
      .toBe('SET #userId = :oldUserId, #gsipk = :oldGsipk');
    expect(transactions[1].input.TransactItems[2].Update.ExpressionAttributeValues[':oldGsipk'].S).toBe(oldSub);
    expect(mockWriteAuditLog.mock.calls.map((call) => call[2])).toEqual([
      'ACCOUNT_MIGRATION_STARTED',
      'ACCOUNT_MIGRATION_COMPLETED',
      'ACCOUNT_MIGRATION_FAILED',
    ]);
  });

  it('updates non-keyed records and restores their original owner on rollback', async () => {
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return {};
      if (command instanceof QueryCommand) {
        return {
          Items: [marshall({
            pk: 'profile::shared',
            sk: 'profile',
            userId: oldSub,
            email: 'person@example.test',
          })],
        };
      }
      if (command instanceof TransactWriteItemsCommand) return {};
      throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
    });

    const rollback = await migrateAccounts(oldSub, newSub);
    const migration = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteItemsCommand);
    expect(migration.input.TransactItems).toHaveLength(1);
    expect(migration.input.TransactItems[0].Update.ExpressionAttributeValues[':newUserId'].S).toBe(newSub);
    expect(migration.input.TransactItems[0].Update.Key.pk.S).toBe('profile::shared');
    expect(migration.input.TransactItems[0].Update.UpdateExpression).toBe('SET #userId = :newUserId');

    await rollback(new Error('later step failed'));

    const transactions = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof TransactWriteItemsCommand);
    expect(transactions[1].input.TransactItems[0].Update.ExpressionAttributeValues[':oldUserId'].S).toBe(oldSub);
    expect(transactions[1].input.TransactItems[0].Update.Key.pk.S).toBe('profile::shared');
    expect(transactions[1].input.TransactItems[0].Update.UpdateExpression).toBe('SET #userId = :oldUserId');
  });

  it('returns a rollback even when the old account has no records', async () => {
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return {};
      if (command instanceof QueryCommand) return { Items: [] };
      if (command instanceof TransactWriteItemsCommand) return {};
      throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
    });

    const rollback = await migrateAccounts(oldSub, newSub);
    await rollback(new Error('later step failed'));

    expect(mockDynamoSend.mock.calls.some(([command]) => (
      command instanceof TransactWriteItemsCommand
    ))).toBe(false);
    expect(mockWriteAuditLog.mock.calls.map((call) => call[2])).toEqual([
      'ACCOUNT_MIGRATION_STARTED',
      'ACCOUNT_MIGRATION_COMPLETED',
      'ACCOUNT_MIGRATION_FAILED',
    ]);
  });

  it('rejects a keyed migration when the target key belongs to another account', async () => {
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof QueryCommand) return { Items: [marshall(sourceItems[0])] };
      if (command instanceof GetItemCommand) {
        return { Item: marshall({ ...sourceItems[0], pk: 'booking::new-sub', userId: 'another-user' }) };
      }
      throw new Error(`Unexpected DynamoDB command: ${command.constructor.name}`);
    });

    await expect(migrateAccounts(oldSub, newSub)).rejects.toThrow('Migration key collision detected');
    expect(mockDynamoSend.mock.calls.some(([command]) => (
      command instanceof TransactWriteItemsCommand
    ))).toBe(false);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('restores migrated records if the completion audit write fails', async () => {
    mockWriteAuditLog.mockImplementation(async (_user, _entityId, operation) => {
      if (operation === 'ACCOUNT_MIGRATION_COMPLETED') {
        throw new Error('audit unavailable');
      }
    });

    await expect(migrateAccounts(oldSub, newSub)).rejects.toThrow('audit unavailable');

    const transactions = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof TransactWriteItemsCommand);
    expect(transactions).toHaveLength(2);
    expect(transactions[1].input.TransactItems[0].Delete.Key.pk.S).toBe('booking::new-sub');
    expect(transactions[1].input.TransactItems[1].Put.Item.pk.S).toBe('booking::old-sub');
    expect(mockWriteAuditLog.mock.calls.map((call) => call[2])).toEqual([
      'ACCOUNT_MIGRATION_STARTED',
      'ACCOUNT_MIGRATION_COMPLETED',
      'ACCOUNT_MIGRATION_FAILED',
    ]);
  });
});
