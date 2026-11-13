const { randomUUID } = require('crypto');
const { logger } = require('/opt/base');
const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
  DeleteItemCommand,
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
const { migrateAccounts, getOne } = require('/opt/dynamodb');

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

  let oldUserProfile;
  let processingToken;
  let migrationLeaseAcquired = false;
  let oldUsername;
  let migrationRollback;
  let oldUser;
  let newUser;
  let previousClaim;
  let hold;
  let transferredAttributes = [];
  let claimTransferAttempted = false;
  let attributesTransferAttempted = false;

  try {
    const holdResult = await dynamodb.send(new GetItemCommand({
      TableName: TRANS_TABLE,
      Key: marshall({ pk: 'migrateHold', sk: username }),
      ConsistentRead: true,
    }));

    if (!holdResult.Item) return event;

    hold = unmarshall(holdResult.Item);

    // migrateHold is already completed, no action required
    if (hold.status === 'completed') return event;

    const holdExpired = !Number.isFinite(hold.holdExpiry) || hold.holdExpiry <= Date.now();

    // If a hold (pending or confirmed) has expired, clear/void it and let normal signup proceed
    if (holdExpired && ['pending', 'confirmed'].includes(hold.status)) {
      logger.info('event=migration_hold_expired_clearing', { username, status: hold.status });
      await dynamodb.send(new UpdateItemCommand({
        TableName: TRANS_TABLE,
        Key: marshall({ pk: 'migrateHold', sk: username }),
        UpdateExpression: 'SET #status = :expired',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({ ':expired': 'expired' }),
      }));
      return event;
    }

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

    processingToken = randomUUID();
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
    // If we reach this point, we have successfully acquired the migration lease and can proceed with the migration
    migrationLeaseAcquired = true;

    oldUsername = hold.oldParksUsername || hold.oldParksSub;

    oldUser = await getUser(event.userPoolId, oldUsername);
    if (!oldUser) {
      logger.warn('event=migration_source_account_missing', { oldUsername });
      // Source BC Parks account was deleted; void the hold and let the BCSC user proceed cleanly
      await dynamodb.send(new UpdateItemCommand({
        TableName: TRANS_TABLE,
        Key: marshall({ pk: 'migrateHold', sk: username }),
        UpdateExpression: 'SET #status = :voided',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({ ':voided': 'voided' }),
      }));
      return event;
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

    // Read the old user profile record directly by sub
    oldUserProfile = await getOne('user', oldSub, TRANS_TABLE);
    let migratedUserProfile = null;

    if (oldUserProfile) {
      // Carry over review state, createdAt, and existing profile attributes to the new sub
      migratedUserProfile = {
        ...oldUserProfile,
        sk: newSub,
        sub: newSub,
        username: hold.newBcscUsername,
        lastModified: new Date().toISOString(),
      };
    }

    migrationRollback = await migrateAccounts(oldSub, newSub);
    claimTransferAttempted = Boolean(canonicalizeEmail(event.request?.userAttributes?.email));
    const claimResult = await transferEmailClaim(event, hold);
    previousClaim = claimResult?.Attributes ? unmarshall(claimResult.Attributes) : null;

    // Put the user profile under the new sub and delete the old one
    if (migratedUserProfile) {
      await dynamodb.send(new PutItemCommand({
        TableName: TRANS_TABLE,
        Item: marshall(migratedUserProfile, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
    }

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

    // Delete the old user's profile record as well
    if (oldUserProfile) {
      await dynamodb.send(new DeleteItemCommand({
        TableName: TRANS_TABLE,
        Key: marshall({ pk: 'user', sk: oldSub }),
      }));
    }

    await deleteUser(event.userPoolId, oldUsername);
  } catch (error) {
    // If we failed to acquire the migration lease, we cannot safely perform any cleanup or rollback,
    // so we must throw the error and let the user try again later
    if (!migrationLeaseAcquired) throw error;

    const cleanupErrors = [];
    let rollbackFailed = false;

    if (attributesTransferAttempted) {
      try {
        await restoreUserAttributes(
          event.userPoolId,
          hold?.newBcscUsername,
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
        rollbackFailed = true;
        cleanupErrors.push(rollbackError);
      }
    }

    // If data rollback FAILED, do NOT release the migration hold or delete the new user,
    // prevent from wiping or restarting
    if (!rollbackFailed) {
      if (processingToken) {
        try {
          // Release the migration hold so that the user can try again
          await releaseMigrationHold(username, processingToken, error);
        } catch (releaseError) {
          logger.error('Migration hold recovery failed', {
            error: releaseError.message,
            originalError: error.message,
          });
          cleanupErrors.push(releaseError);
        }
      }

      try {
        // Delete the new user so that they can try again
        await deleteUser(event.userPoolId, username);
      } catch (deleteError) {
        logger.error('Failed to delete new account after migration failure', {
          error: deleteError.message,
          originalError: error.message,
        });
        cleanupErrors.push(deleteError);
      }

      // If we had an old user profile record, attempt to restore it under the new sub
      if (oldUserProfile) {
        try {
          await dynamodb.send(new PutItemCommand({
            TableName: TRANS_TABLE,
            Item: marshall(oldUserProfile, { removeUndefinedValues: true }),
          }));
          await dynamodb.send(new DeleteItemCommand({
            TableName: TRANS_TABLE,
            Key: marshall({ pk: 'user', sk: newSub }),
          }));
        } catch (profileRollbackErr) {
          logger.error('Failed to rollback user profile record', { error: profileRollbackErr.message });
          cleanupErrors.push(profileRollbackErr);
        }
      }
    } else {
      logger.error('Data rollback failed; preserving new user and hold', {
        newUsername: hold?.newBcscUsername,
        oldUsername,
      });
    }

    if (cleanupErrors.length) {
      throw new AggregateError([error, ...cleanupErrors], 'Migration failed and cleanup was incomplete');
    }
    throw error;
  }

  // Since migration succeeded, log and catch any errors so it doesn't fail sign-in
  if (processingToken) {
    try {
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
    } catch (cleanupErr) {
      logger.warn('Failed to remove processing tokens on completed migration (non-fatal)', { error: cleanupErr.message });
    }
  }

  logger.info('event=migration_completed', { oldSub: hold?.oldParksSub, newSub });

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
