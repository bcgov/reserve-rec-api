const { randomUUID } = require('crypto');
const { logger } = require('/opt/base');
const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  AdminDeleteUserAttributesCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { canonicalizeEmail } = require('/opt/emailBlocklist');
const { migrateAccounts } = require('/opt/dynamodb');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const TRANS_TABLE = process.env.TRANSACTIONAL_DATA_TABLE_NAME;
const CLAIM_TABLE = process.env.CLAIM_TABLE_NAME;
const MIGRATION_WINDOW = 60_000;
const SIGNUP_SOURCE = 'PostConfirmation_ConfirmSignUp';
const ATTRIBUTES_TO_COPY = [
  'custom:vehicleRegLocale',
  'custom:licensePlate',
  'custom:secondaryNumber',
];

async function releaseMigrationHold(username, processingToken, error) {
  await dynamodb.send(new UpdateItemCommand({
    TableName: TRANS_TABLE,
    Key: marshall({ pk: 'migrateHold', sk: username }),
    UpdateExpression: 'SET #status = :confirmed, #lastFailureAt = :failedAt, #lastFailure = :failure REMOVE #processingToken, #leaseExpiresAt',
    ConditionExpression: '(#status = :processing OR #status = :completed) AND #processingToken = :processingToken',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#lastFailureAt': 'lastFailureAt',
      '#lastFailure': 'lastFailure',
      '#processingToken': 'processingToken',
      '#leaseExpiresAt': 'leaseExpiresAt',
    },
    ExpressionAttributeValues: marshall({
      ':confirmed': 'confirmed',
      ':failedAt': new Date().toISOString(),
      ':failure': error?.name || 'MigrationError',
      ':processing': 'processing',
      ':completed': 'completed',
      ':processingToken': processingToken,
    }),
  }));
}

async function getUser(userPoolId, username) {
  try {
    return await cognito.send(new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }));
  } catch (error) {
    if (error.name === 'UserNotFoundException') return null;
    throw error;
  }
}

function getAttributeValue(user, name) {
  return user?.UserAttributes?.find((attribute) => attribute.Name === name)?.Value;
}

function hasAttributeValue(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function getAttributesToTransfer(oldUser, newUser) {
  const attributes = ATTRIBUTES_TO_COPY.flatMap((name) => {
    const value = getAttributeValue(oldUser, name);
    return hasAttributeValue(value) ? [{ Name: name, Value: value }] : [];
  });

  const oldMobilePhone = getAttributeValue(oldUser, 'custom:mobilePhone');
  const newMobilePhone = getAttributeValue(newUser, 'custom:mobilePhone');
  if (hasAttributeValue(oldMobilePhone) && !hasAttributeValue(newMobilePhone)) {
    attributes.push({ Name: 'custom:mobilePhone', Value: oldMobilePhone });
  }

  return attributes;
}

async function updateUser(userPoolId, username, attributes) {
  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: userPoolId,
    Username: username,
    UserAttributes: attributes,
  }));
}

async function restoreUserAttributes(userPoolId, username, attributes, attributeNames) {
  const attributesToRestore = attributeNames.flatMap((name) => {
    const value = getAttributeValue({ UserAttributes: attributes }, name);
    return value === undefined ? [] : [{ Name: name, Value: value }];
  });
  const attributesToDelete = attributeNames.filter((name) => (
    getAttributeValue({ UserAttributes: attributes }, name) === undefined
  ));

  if (attributesToRestore.length) {
    await updateUser(userPoolId, username, attributesToRestore);
  }
  if (attributesToDelete.length) {
    await cognito.send(new AdminDeleteUserAttributesCommand({
      UserPoolId: userPoolId,
      Username: username,
      UserAttributeNames: attributesToDelete,
    }));
  }
}

async function deleteUser(userPoolId, username) {
  try {
    await cognito.send(new AdminDeleteUserCommand({
      UserPoolId: userPoolId,
      Username: username,
    }));
  } catch (error) {
    if (error.name !== 'UserNotFoundException') throw error;
  }
}

async function transferEmailClaim(event, hold) {
  const email = canonicalizeEmail(event.request?.userAttributes?.email);
  if (!email) {
    throw new Error('Migration is missing a valid email address for its claim');
  }

  return dynamodb.send(new UpdateItemCommand({
    TableName: CLAIM_TABLE,
    Key: marshall({ pk: email }),
    UpdateExpression: 'SET #owner = :newOwner, #source = :bcsc, #claimedAt = :claimedAt',
    ConditionExpression: '(#owner = :oldOwner AND #source = :parks) OR (attribute_not_exists(#owner) AND attribute_not_exists(#source)) OR (#owner = :newOwner AND #source = :bcsc)',
    ExpressionAttributeNames: {
      '#owner': 'owner',
      '#source': 'source',
      '#claimedAt': 'claimedAt',
    },
    ExpressionAttributeValues: marshall({
      ':newOwner': event.userName,
      ':bcsc': 'bcsc',
      ':claimedAt': new Date().toISOString(),
      ':oldOwner': hold.oldParksUsername || hold.oldParksSub,
      ':parks': 'bcparks',
    }),
    ReturnValues: 'ALL_OLD',
  }));
}

async function restoreEmailClaim(event, hold, previousClaim) {
  const oldClaim = previousClaim || {};
  const claimedAt = oldClaim.claimedAt;
  const updateExpression = claimedAt
    ? 'SET #owner = :oldOwner, #source = :parks, #claimedAt = :claimedAt'
    : 'SET #owner = :oldOwner, #source = :parks REMOVE #claimedAt';

  await dynamodb.send(new UpdateItemCommand({
    TableName: CLAIM_TABLE,
    Key: marshall({ pk: canonicalizeEmail(event.request?.userAttributes?.email) }),
    UpdateExpression: updateExpression,
    ConditionExpression: '#owner = :newOwner AND #source = :bcsc',
    ExpressionAttributeNames: {
      '#owner': 'owner',
      '#source': 'source',
      '#claimedAt': 'claimedAt',
    },
    ExpressionAttributeValues: marshall({
      ':oldOwner': hold.oldParksUsername || hold.oldParksSub,
      ':parks': 'bcparks',
      ...(claimedAt ? { ':claimedAt': claimedAt } : {}),
      ':newOwner': event.userName,
      ':bcsc': 'bcsc',
    }),
  }));
}

async function migrateConfirmedAccount(event) {
  const username = event.userName;
  const newSub = event.request?.userAttributes?.sub;
  const holdResult = await dynamodb.send(new GetItemCommand({
    TableName: TRANS_TABLE,
    Key: marshall({ pk: 'migrateHold', sk: username }),
    ConsistentRead: true,
  }));

  if (!holdResult.Item) return event;

  const hold = unmarshall(holdResult.Item);

  // migrateHold is already completed, no action required
  if (hold.status === 'completed') return event;

  if (hold.status !== 'confirmed'
    && !(hold.status === 'processing'
      && (!Number.isFinite(hold.leaseExpiresAt) || hold.leaseExpiresAt <= Date.now()))) {
    if (hold.status === 'processing') {
      throw new Error('Account migration is already in progress');
    }
    return event;
  }

  if (hold.newBcscUsername !== username || !hold.oldParksSub || !newSub) {
    throw new Error('Migration hold is missing an account identifier');
  }

  const processingToken = randomUUID();
  const now = Date.now();
  await dynamodb.send(new UpdateItemCommand({
    TableName: TRANS_TABLE,
    Key: marshall({ pk: 'migrateHold', sk: username }),
    UpdateExpression: 'SET #status = :processing, #processingToken = :processingToken, #leaseExpiresAt = :leaseExpiresAt',
    ConditionExpression: '(#status = :confirmed) OR (#status = :processing AND (attribute_not_exists(#leaseExpiresAt) OR #leaseExpiresAt <= :now))',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#processingToken': 'processingToken',
      '#leaseExpiresAt': 'leaseExpiresAt',
    },
    ExpressionAttributeValues: marshall({
      ':processing': 'processing',
      ':confirmed': 'confirmed',
      ':processingToken': processingToken,
      ':leaseExpiresAt': now + MIGRATION_WINDOW,
      ':now': now,
    }),
  }));

  const oldUsername = hold.oldParksUsername || hold.oldParksSub;
  let migrationRollback;
  let oldUser;
  let newUser;
  let previousClaim;
  let transferredAttributes = [];
  let claimTransferAttempted = false;
  let attributesTransferAttempted = false;
  try {
    oldUser = await getUser(event.userPoolId, oldUsername);
    if (!oldUser) {
      throw new Error('BC Parks account was not found during migration');
    }
    const oldSub = getAttributeValue(oldUser, 'sub');
    if (!oldSub || (hold.oldParksUsername && oldSub !== hold.oldParksSub)) {
      throw new Error('Migration hold does not match the BC Parks account');
    }

    newUser = await getUser(event.userPoolId, hold.newBcscUsername);
    if (!newUser) {
      throw new Error('New account was not found during attribute migration');
    }

    logger.info('event=migration_processing', { oldSub, newSub });
    migrationRollback = await migrateAccounts(oldSub, newSub);
    claimTransferAttempted = Boolean(canonicalizeEmail(event.request?.userAttributes?.email));
    const claimResult = await transferEmailClaim(event, hold);
    previousClaim = claimResult?.Attributes ? unmarshall(claimResult.Attributes) : null;

    await dynamodb.send(new UpdateItemCommand({
      TableName: TRANS_TABLE,
      Key: marshall({ pk: 'migrateHold', sk: username }),
      UpdateExpression: 'SET #status = :completed, #completedAt = :completedAt',
      ConditionExpression: '#status = :processing AND #processingToken = :processingToken',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#completedAt': 'completedAt',
        '#processingToken': 'processingToken',
      },
      ExpressionAttributeValues: marshall({
        ':completed': 'completed',
        ':completedAt': new Date().toISOString(),
        ':processing': 'processing',
        ':processingToken': processingToken,
      }),
    }));

    const attributes = getAttributesToTransfer(oldUser, newUser);
    if (attributes.length) {
      transferredAttributes = attributes.map(({ Name }) => Name);
      attributesTransferAttempted = true;
      await updateUser(event.userPoolId, hold.newBcscUsername, attributes);
    }

    await deleteUser(event.userPoolId, oldUsername);
  } catch (error) {
    const cleanupErrors = [];

    if (attributesTransferAttempted) {
      try {
        await restoreUserAttributes(
          event.userPoolId,
          hold.newBcscUsername,
          newUser?.UserAttributes || [],
          transferredAttributes,
        );
      } catch (restoreError) {
        logger.error('Migration attribute recovery failed', {
          error: restoreError.message,
          originalError: error.message,
        });
        cleanupErrors.push(restoreError);
      }
    }
    if (claimTransferAttempted) {
      try {
        await restoreEmailClaim(event, hold, previousClaim);
      } catch (restoreError) {
        logger.error('Migration claim recovery failed', {
          error: restoreError.message,
          originalError: error.message,
        });
        cleanupErrors.push(restoreError);
      }
    }
    if (migrationRollback) {
      try {
        await migrationRollback(error);
      } catch (rollbackError) {
        logger.error('Migration data recovery failed', {
          error: rollbackError.message,
          originalError: error.message,
        });
        cleanupErrors.push(rollbackError);
      }
    }
    try {
      await releaseMigrationHold(username, processingToken, error);
    } catch (releaseError) {
      logger.error('Migration hold recovery failed', {
        error: releaseError.message,
        originalError: error.message,
      });
      cleanupErrors.push(releaseError);
    }
    try {
      await deleteUser(event.userPoolId, username);
    } catch (deleteError) {
      logger.error('Failed to delete new account after migration failure', {
        error: deleteError.message,
        originalError: error.message,
      });
      cleanupErrors.push(deleteError);
    }

    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], 'Migration failed and cleanup was incomplete');
    }
    throw error;
  }

  await dynamodb.send(new UpdateItemCommand({
    TableName: TRANS_TABLE,
    Key: marshall({ pk: 'migrateHold', sk: username }),
    UpdateExpression: 'REMOVE #processingToken, #leaseExpiresAt',
    ConditionExpression: '#status = :completed AND #processingToken = :processingToken',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#processingToken': 'processingToken',
      '#leaseExpiresAt': 'leaseExpiresAt',
    },
    ExpressionAttributeValues: marshall({
      ':completed': 'completed',
      ':processingToken': processingToken,
    }),
  }));

  logger.info('event=migration_completed', { oldSub: hold.oldParksSub, newSub });

  return event;
}

exports.handler = async (event) => {
  if (!event) return event;

  if (event.triggerSource === SIGNUP_SOURCE) {
    const sub = event.request?.userAttributes?.sub || null;
    const federated = typeof event.userName === 'string' && event.userName.includes('_');
    logger.info('event=account_confirmed', { sub, federated });
  }

  if (event.triggerSource !== SIGNUP_SOURCE || !/^bcsc_/i.test(event.userName || '')) {
    return event;
  }

  return migrateConfirmedAccount(event);
};
