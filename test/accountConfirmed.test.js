process.env.TRANSACTIONAL_DATA_TABLE_NAME = 'transactions';
process.env.CLAIM_TABLE_NAME = 'claims';

const mockDynamoSend = jest.fn();
const mockCognitoSend = jest.fn();
const mockMigrateAccounts = jest.fn();

jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('/opt/base');

jest.mock('/opt/dynamodb', () => ({
  migrateAccounts: (...args) => mockMigrateAccounts(...args),
}));

jest.mock('/opt/emailBlocklist', () => ({
  canonicalizeEmail: (email) => email?.trim().toLowerCase() || null,
}));

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn(() => ({ send: (...args) => mockDynamoSend(...args) })),
  };
});

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return {
    ...actual,
    CognitoIdentityProviderClient: jest.fn(() => ({ send: (...args) => mockCognitoSend(...args) })),
  };
});

const { GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const {
  AdminDeleteUserCommand,
  AdminDeleteUserAttributesCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { handler } = require('../lib/handlers/cognitoTriggers/accountConfirmed');

const regularEvent = (triggerSource, userName = 'a-b-c-d') => ({
  triggerSource,
  userName,
  request: { userAttributes: { sub: 'sub-1', email: 'person@example.com' } },
  response: {},
});

const migrationEvent = {
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  userPoolId: 'public-pool',
  userName: 'bcsc_12345',
  request: { userAttributes: { sub: 'new-sub', email: 'person@example.com' } },
};

const confirmedHold = {
  pk: 'migrateHold',
  sk: 'bcsc_12345',
  status: 'confirmed',
  oldParksSub: 'old-sub',
  oldParksUsername: 'parks-user',
  newBcscUsername: 'bcsc_12345',
};

const oldUser = {
  UserAttributes: [
    { Name: 'sub', Value: 'old-sub' },
    { Name: 'custom:vehicleRegLocale', Value: 'en-CA' },
    { Name: 'custom:licensePlate', Value: 'ABC123' },
    { Name: 'custom:secondaryNumber', Value: '555-1234' },
    { Name: 'custom:mobilePhone', Value: '+15550001' },
  ],
};

let mockUsers;

describe('PostConfirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsers = {
      'parks-user': oldUser,
      'bcsc_12345': {
        UserAttributes: [{ Name: 'custom:mobilePhone', Value: '+15559999' }],
      },
    };
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand && command.input.Key.sk.S === 'bcsc_12345') {
        return { Item: marshall(confirmedHold) };
      }
      if (command instanceof GetItemCommand) return {};
      return {};
    });
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) {
        const user = mockUsers[command.input.Username];
        if (!user) {
          throw Object.assign(new Error('User not found'), { name: 'UserNotFoundException' });
        }
        return user;
      }
      return {};
    });
    mockMigrateAccounts.mockResolvedValue(undefined);
  });

  it('logs a confirmed signup and returns the event untouched', async () => {
    const ev = regularEvent('PostConfirmation_ConfirmSignUp');
    await expect(handler(ev)).resolves.toBe(ev);
    expect(logger.info).toHaveBeenCalledWith('event=account_confirmed', { sub: 'sub-1', federated: false });
  });

  it('marks a federated confirmation', async () => {
    await handler(regularEvent('PostConfirmation_ConfirmSignUp', 'bcsc_abc123'));
    expect(logger.info).toHaveBeenCalledWith('event=account_confirmed', expect.objectContaining({ federated: true }));
  });

  it('does not count a forgotten-password confirmation as a signup', async () => {
    await handler(regularEvent('PostConfirmation_ConfirmForgotPassword'));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('never logs the address', async () => {
    await handler(regularEvent('PostConfirmation_ConfirmSignUp'));
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('person@example.com');
  });

  it('fails open', async () => {
    await expect(handler(null)).resolves.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('migrates records, deletes the old user, and completes the hold on initial federated confirmation', async () => {
    const result = await handler(migrationEvent);

    expect(result).toBe(migrationEvent);
    expect(mockMigrateAccounts).toHaveBeenCalledWith('old-sub', 'new-sub');
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.any(AdminDeleteUserCommand));
    const deleteCall = mockCognitoSend.mock.calls.find(([command]) => command instanceof AdminDeleteUserCommand);
    expect(deleteCall[0].input).toEqual({
      UserPoolId: 'public-pool',
      Username: 'parks-user',
    });
    const updateCall = mockCognitoSend.mock.calls.find(
      ([command]) => command instanceof AdminUpdateUserAttributesCommand,
    );
    expect(updateCall[0].input).toEqual({
      UserPoolId: 'public-pool',
      Username: 'bcsc_12345',
      UserAttributes: [
        { Name: 'custom:vehicleRegLocale', Value: 'en-CA' },
        { Name: 'custom:licensePlate', Value: 'ABC123' },
        { Name: 'custom:secondaryNumber', Value: '555-1234' },
      ],
    });
    const updateCallIndex = mockCognitoSend.mock.calls.indexOf(updateCall);
    const deleteCallIndex = mockCognitoSend.mock.calls.indexOf(deleteCall);
    expect(mockCognitoSend.mock.invocationCallOrder[updateCallIndex])
      .toBeLessThan(mockCognitoSend.mock.invocationCallOrder[deleteCallIndex]);
    expect(mockDynamoSend.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'GetItemCommand',
      'UpdateItemCommand',
      'UpdateItemCommand',
      'UpdateItemCommand',
      'UpdateItemCommand',
    ]);
    const claimUpdate = mockDynamoSend.mock.calls[2][0];
    expect(claimUpdate.input.TableName).toBe('claims');
    expect(claimUpdate.input.Key.pk.S).toBe('person@example.com');
    expect(claimUpdate.input.ExpressionAttributeValues[':oldOwner'].S).toBe('parks-user');
    expect(claimUpdate.input.ExpressionAttributeValues[':newOwner'].S).toBe('bcsc_12345');
    expect(claimUpdate.input.ExpressionAttributeValues[':parks'].S).toBe('bcparks');
    expect(claimUpdate.input.ExpressionAttributeValues[':bcsc'].S).toBe('bcsc');
    expect(claimUpdate.input.ConditionExpression)
      .toContain('(attribute_not_exists(#owner) AND attribute_not_exists(#source))');
    expect(mockDynamoSend.mock.calls[3][0].input.UpdateExpression).toContain(':completed');
    expect(mockDynamoSend.mock.invocationCallOrder[2]).toBeLessThan(
      mockCognitoSend.mock.invocationCallOrder[mockCognitoSend.mock.calls.indexOf(deleteCall)],
    );
  });

  it('supports migration holds created before the old username was stored', async () => {
    mockUsers['old-sub'] = oldUser;
    const legacyHold = { ...confirmedHold };
    delete legacyHold.oldParksUsername;
    mockDynamoSend.mockImplementationOnce(async () => ({ Item: marshall(legacyHold) }));

    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);

    expect(mockMigrateAccounts).toHaveBeenCalledWith('old-sub', 'new-sub');
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ Username: 'old-sub' }),
    }));
    const claimUpdate = mockDynamoSend.mock.calls.find(([command]) => (
      command instanceof UpdateItemCommand && command.input.TableName === 'claims'
    ));
    expect(claimUpdate[0].input.ExpressionAttributeValues[':oldOwner'].S).toBe('old-sub');
  });

  it('copies the old mobile phone only when the new account has no value', async () => {
    mockUsers['bcsc_12345'] = {
      UserAttributes: [{ Name: 'custom:mobilePhone', Value: '   ' }],
    };

    await handler(migrationEvent);

    const updateCall = mockCognitoSend.mock.calls.find(
      ([command]) => command instanceof AdminUpdateUserAttributesCommand,
    );
    expect(updateCall[0].input.UserAttributes).toContainEqual({
      Name: 'custom:mobilePhone',
      Value: '+15550001',
    });
  });

  it('releases the hold and preserves the old account if attribute transfer fails', async () => {
    const rollback = jest.fn().mockResolvedValue(undefined);
    mockMigrateAccounts.mockResolvedValue(rollback);
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) return mockUsers[command.input.Username];
      if (command instanceof AdminUpdateUserAttributesCommand) {
        throw new Error('attribute update failed');
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toThrow('attribute update failed');

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminDeleteUserCommand && command.input.Username === 'parks-user'
    ))).toBe(false);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminDeleteUserCommand && command.input.Username === 'bcsc_12345'
    ))).toBe(true);
    const updates = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateItemCommand);
    expect(updates[updates.length - 1].input.ExpressionAttributeValues[':confirmed'].S).toBe('confirmed');
    expect(updates.some((command) => command.input.UpdateExpression.includes(':completed'))).toBe(true);
  });

  it('rolls records, claims, attributes, and the hold back when old-user deletion fails', async () => {
    const rollback = jest.fn().mockResolvedValue(undefined);
    mockMigrateAccounts.mockResolvedValue(rollback);
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return { Item: marshall(confirmedHold) };
      if (command instanceof UpdateItemCommand
        && command.input.TableName === 'claims'
        && command.input.ConditionExpression.includes(':oldOwner')) {
        return {
          Attributes: marshall({
            pk: 'person@example.com',
            owner: 'parks-user',
            source: 'bcparks',
            claimedAt: 'previous-time',
          }),
        };
      }
      return {};
    });
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) return mockUsers[command.input.Username];
      if (command instanceof AdminDeleteUserCommand && command.input.Username === 'parks-user') {
        throw new Error('old user deletion failed');
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toThrow('old user deletion failed');

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminDeleteUserAttributesCommand
    ))).toBe(true);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminDeleteUserCommand && command.input.Username === 'bcsc_12345'
    ))).toBe(true);
    const updates = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateItemCommand);
    expect(updates[updates.length - 1].input.ExpressionAttributeValues[':confirmed'].S).toBe('confirmed');
    expect(updates[updates.length - 2].input.ConditionExpression).toContain('#source = :bcsc');
    expect(updates[updates.length - 2].input.UpdateExpression).toContain(':claimedAt');
  });

  it('restores the hold, preserves the old user, and deletes the new user when data migration fails', async () => {
    mockMigrateAccounts.mockRejectedValue(new Error('transaction failed'));

    await expect(handler(migrationEvent)).rejects.toThrow('transaction failed');

    const updates = mockDynamoSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof UpdateItemCommand);
    expect(updates).toHaveLength(2);
    expect(updates[1].input.ExpressionAttributeValues[':confirmed'].S).toBe('confirmed');
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.any(AdminDeleteUserCommand));
    const deleteCall = mockCognitoSend.mock.calls.find(([command]) => command instanceof AdminDeleteUserCommand);
    expect(deleteCall[0].input).toEqual({
      UserPoolId: 'public-pool',
      Username: 'bcsc_12345',
    });
    expect(mockDynamoSend.mock.calls.some(([command]) => (
      command instanceof UpdateItemCommand && command.input.TableName === 'claims'
    ))).toBe(false);
  });

  it('does not delete the old user if the email claim cannot be transferred', async () => {
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return { Item: marshall(confirmedHold) };
      if (command instanceof UpdateItemCommand && command.input.TableName === 'claims') {
        throw Object.assign(new Error('claim changed'), { name: 'ConditionalCheckFailedException' });
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: expect.arrayContaining([expect.objectContaining({ message: 'claim changed' })]),
    });

    expect(mockMigrateAccounts).toHaveBeenCalledWith('old-sub', 'new-sub');
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.any(AdminDeleteUserCommand));
    expect(mockDynamoSend.mock.calls.some(([command]) => (
      command instanceof UpdateItemCommand && command.input.UpdateExpression.includes(':completed')
    ))).toBe(false);
  });

  it('does not process unrelated authentications', async () => {
    const event = { ...migrationEvent, userName: 'native-user' };
    await expect(handler(event)).resolves.toBe(event);
    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });

  it('passes through completed holds and migrates expired processing leases', async () => {
    mockDynamoSend.mockImplementationOnce(async () => ({
      Item: marshall({ ...confirmedHold, status: 'completed' }),
    }));
    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);
    expect(mockMigrateAccounts).not.toHaveBeenCalled();

    mockDynamoSend.mockImplementationOnce(async () => ({
      Item: marshall({ ...confirmedHold, status: 'processing', leaseExpiresAt: Date.now() - 1 }),
    }));
    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);
    expect(mockMigrateAccounts).toHaveBeenCalledWith('old-sub', 'new-sub');
  });

  it('does not run while another migration still holds an active lease', async () => {
    mockDynamoSend.mockImplementationOnce(async () => ({
      Item: marshall({ ...confirmedHold, status: 'processing', leaseExpiresAt: Date.now() + 60_000 }),
    }));

    await expect(handler(migrationEvent)).rejects.toThrow('Account migration is already in progress');
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
    expect(mockCognitoSend).not.toHaveBeenCalled();
  });

  it('reclaims a processing hold whose lease is missing', async () => {
    mockDynamoSend.mockImplementationOnce(async () => ({
      Item: marshall({ ...confirmedHold, status: 'processing' }),
    }));

    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);

    expect(mockDynamoSend.mock.calls[1][0].input.ConditionExpression)
      .toContain('attribute_not_exists(#leaseExpiresAt)');
    expect(mockMigrateAccounts).toHaveBeenCalledWith('old-sub', 'new-sub');
  });

  it('passes through when no migration hold exists', async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });

  it('passes through a pending hold and rejects a hold without a new account sub', async () => {
    mockDynamoSend.mockImplementationOnce(async () => ({
      Item: marshall({ ...confirmedHold, status: 'pending' }),
    }));
    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);

    const invalidEvent = {
      ...migrationEvent,
      request: { userAttributes: { email: 'person@example.com' } },
    };
    await expect(handler(invalidEvent)).rejects.toThrow('Migration hold is missing an account identifier');
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });

  it('restores the hold and removes the new user when the old account is missing', async () => {
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand && command.input.Username === 'parks-user') {
        throw Object.assign(new Error('missing old account'), { name: 'UserNotFoundException' });
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toThrow('BC Parks account was not found');
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
    expect(mockCognitoSend).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ Username: 'bcsc_12345' }),
    }));
  });

  it('surfaces Cognito lookup failures instead of treating them as missing users', async () => {
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand && command.input.Username === 'parks-user') {
        throw Object.assign(new Error('Cognito unavailable'), { name: 'TooManyRequestsException' });
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toThrow('Cognito unavailable');
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });

  it('rejects a hold whose old account sub no longer matches', async () => {
    mockUsers['parks-user'] = {
      UserAttributes: [{ Name: 'sub', Value: 'different-sub' }],
    };

    await expect(handler(migrationEvent)).rejects.toThrow('does not match the BC Parks account');
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });

  it('restores the hold and removes the new user when the new Cognito account is missing', async () => {
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) {
        if (command.input.Username === 'bcsc_12345') {
          throw Object.assign(new Error('missing new account'), { name: 'UserNotFoundException' });
        }
        return mockUsers[command.input.Username];
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toThrow('New account was not found');
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });

  it('continues migration without overwriting values when old attributes are blank', async () => {
    mockUsers['parks-user'] = {
      UserAttributes: [
        { Name: 'sub', Value: 'old-sub' },
        { Name: 'custom:vehicleRegLocale', Value: '  ' },
        { Name: 'custom:licensePlate', Value: '' },
        { Name: 'custom:secondaryNumber', Value: '  ' },
        { Name: 'custom:mobilePhone', Value: '  ' },
      ],
    };

    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminUpdateUserAttributesCommand
    ))).toBe(false);
  });

  it('uses the original hold failure reason when cleanup has no user attribute snapshot', async () => {
    const rollback = jest.fn().mockResolvedValue(undefined);
    mockMigrateAccounts.mockResolvedValue(rollback);
    mockUsers['bcsc_12345'] = {};
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) return mockUsers[command.input.Username];
      if (command instanceof AdminDeleteUserCommand && command.input.Username === 'parks-user') {
        throw { message: 'old user deletion failed' };
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toMatchObject({
      message: 'old user deletion failed',
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminDeleteUserAttributesCommand
    ))).toBe(true);
  });

  it('treats a missing old user during deletion as an already-completed cleanup', async () => {
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) return mockUsers[command.input.Username];
      if (command instanceof AdminDeleteUserCommand && command.input.Username === 'parks-user') {
        throw Object.assign(new Error('already deleted'), { name: 'UserNotFoundException' });
      }
      return {};
    });

    await expect(handler(migrationEvent)).resolves.toBe(migrationEvent);
    expect(mockCognitoSend.mock.calls.some(([command]) => (
      command instanceof AdminDeleteUserCommand && command.input.Username === 'bcsc_12345'
    ))).toBe(false);
  });

  it('reverts the migrated claim when the event has no usable email', async () => {
    const rollback = jest.fn().mockResolvedValue(undefined);
    mockMigrateAccounts.mockResolvedValue(rollback);
    const event = {
      ...migrationEvent,
      request: { userAttributes: { sub: 'new-sub' } },
    };

    await expect(handler(event)).rejects.toThrow('missing a valid email address');
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend.mock.calls.some(([command]) => (
      command instanceof UpdateItemCommand && command.input.TableName === 'claims'
    ))).toBe(false);
  });

  it('surfaces incomplete cleanup after restoring attributes, data, hold, and new user', async () => {
    const rollback = jest.fn().mockRejectedValue(new Error('data rollback failed'));
    mockMigrateAccounts.mockResolvedValue(rollback);
    mockUsers['bcsc_12345'] = {
      UserAttributes: [
        { Name: 'custom:mobilePhone', Value: '+15559999' },
        { Name: 'custom:licensePlate', Value: 'NEW-PLATE' },
      ],
    };
    mockCognitoSend.mockImplementation(async (command) => {
      if (command instanceof AdminGetUserCommand) return mockUsers[command.input.Username];
      if (command instanceof AdminUpdateUserAttributesCommand) {
        if (command.input.UserAttributes.some(({ Value }) => Value === 'NEW-PLATE')) {
          throw new Error('attribute rollback failed');
        }
        return {};
      }
      if (command instanceof AdminDeleteUserCommand) {
        if (command.input.Username === 'parks-user') throw new Error('old user deletion failed');
        throw new Error(`delete failed for ${command.input.Username}`);
      }
      return {};
    });
    mockDynamoSend.mockImplementation(async (command) => {
      if (command instanceof GetItemCommand) return { Item: marshall(confirmedHold) };
      if (command instanceof UpdateItemCommand
        && command.input.ConditionExpression === '#owner = :newOwner AND #source = :bcsc') {
        throw new Error('claim rollback failed');
      }
      if (command instanceof UpdateItemCommand && command.input.UpdateExpression.includes('#lastFailureAt')) {
        throw new Error('hold rollback failed');
      }
      return {};
    });

    await expect(handler(migrationEvent)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: expect.arrayContaining([
        expect.objectContaining({ message: 'old user deletion failed' }),
        expect.objectContaining({ message: 'attribute rollback failed' }),
        expect.objectContaining({ message: 'claim rollback failed' }),
        expect.objectContaining({ message: 'data rollback failed' }),
        expect.objectContaining({ message: 'hold rollback failed' }),
        expect.objectContaining({ message: 'delete failed for bcsc_12345' }),
      ]),
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Migration claim recovery failed',
      expect.any(Object),
    );
  });

  it('does not run migration from later PostAuthentication logins', async () => {
    const event = { ...migrationEvent, triggerSource: 'PostAuthentication_Authentication' };
    await expect(handler(event)).resolves.toBe(event);
    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(mockMigrateAccounts).not.toHaveBeenCalled();
  });
});
