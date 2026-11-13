const { createHash, timingSafeEqual } = require('crypto');
const { Exception, logger, sendResponse } = require('/opt/base');
const {
  DynamoDBClient,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const {
  getOneByGlobalId,
  TRANSACTIONAL_DATA_TABLE_NAME,
} = require('/opt/dynamodb');
const { canonicalizeEmail } = require('/opt/emailBlocklist');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const CLAIM_TABLE_NAME = process.env.CLAIM_TABLE_NAME;
const PUBLIC_USER_POOL_ID = process.env.PUBLIC_USER_POOL_ID;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

// Prevents timing attacks by ensuring that the comparison takes the same amount of time regardless of
// how many characters match.
function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

exports.handler = async (event, context) => {
  try {
    let body;
    try {
      body = JSON.parse(event?.body || '{}');
    } catch {
      throw new Exception('A valid migration confirmation request is required.', { code: 400 });
    }
    const { migrateId, token } = body;
    if (typeof migrateId !== 'string' || !UUID_REGEX.test(migrateId)
      || typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
      throw new Exception('The migration confirmation link is invalid.', { code: 400 });
    }

    let hold = await getOneByGlobalId(migrateId, TRANSACTIONAL_DATA_TABLE_NAME);
    
    if (!hold || hold.pk !== 'migrateHold' || hold.globalId !== migrateId
      || !hold.oldParksUsername || !hold.oldParksEmail) {
      throw new Exception('Migration request was not found or is invalid.', { code: 404 });
    }

    if (hold.status === 'completed') {
      return sendResponse(200, { status: hold.status }, 'Migration already completed.', null, context);
    }

    // If the hold is confirmed but the token hash is missing, it means the migration was already confirmed and the token was removed
    if (hold.status === 'confirmed' && !hold.emailConfirmationTokenHash) {
      return sendResponse(200, { status: hold.status }, 'Migration already confirmed.', null, context);
    }

    // If the hold is not pending or confirmed, it means the migration was either cancelled or expired
    if (hold.status !== 'pending' && hold.status !== 'confirmed') {
      throw new Exception('This migration can no longer be confirmed.', { code: 409 });
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    
    // If the hold has a token hash, we need to check if the provided token matches the hash and if the token has expired
    if (hold.emailConfirmationTokenHash) {
      
      // If the token hash does not match, throw an error
      if (!safeEqual(hold.emailConfirmationTokenHash, tokenHash)) {
        throw new Exception('The migration confirmation link is invalid or has expired. Please try again.', { code: 400 });
      }

      // If the hold is pending and the token has expired, throw an error
      if (hold.status === 'pending'
        && (!Number.isFinite(hold.emailConfirmationExpiresAt)
          || hold.emailConfirmationExpiresAt <= Date.now())) {
        throw new Exception('The migration confirmation link has expired. Please try again.', { code: 410 });
      }

    // If the hold is confirmed and the token has expired, throw an error
    } else if (hold.status !== 'confirmed') {
      throw new Exception('The migration confirmation link is invalid or has expired. Please try again.', { code: 400 });
    }

    // If the hold is pending, update the hold to confirmed
    if (hold.status === 'pending') {
      const now = Date.now();
      try {
        await dynamodb.send(new UpdateItemCommand({
          TableName: TRANSACTIONAL_DATA_TABLE_NAME,
          Key: {
            pk: { S: 'migrateHold' },
            sk: { S: hold.sk },
          },
          UpdateExpression: 'SET #status = :confirmed, #confirmedAt = :now, #updatedAt = :now',
          ConditionExpression: '#status = :pending AND #tokenHash = :tokenHash AND #tokenExpiresAt > :now AND #holdExpiry > :now AND #globalId = :migrateId',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#confirmedAt': 'emailConfirmationConfirmedAt',
            '#updatedAt': 'updatedAt',
            '#tokenHash': 'emailConfirmationTokenHash',
            '#tokenExpiresAt': 'emailConfirmationExpiresAt',
            '#holdExpiry': 'holdExpiry',
            '#globalId': 'globalId',
          },
          ExpressionAttributeValues: {
            ':pending': { S: 'pending' },
            ':confirmed': { S: 'confirmed' },
            ':now': { N: String(now) },
            ':tokenHash': { S: tokenHash },
            ':migrateId': { S: migrateId },
          },
        }));
      } catch (error) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
        hold = await getOneByGlobalId(migrateId, TRANSACTIONAL_DATA_TABLE_NAME);
        if (hold?.status !== 'confirmed') {
          throw new Exception('This migration request has expired or was already changed.', { code: 409 });
        }
      }
    }

    // Update the claim table to remove the migrateHoldPending flag and update the Cognito user attributes
    const email = canonicalizeEmail(hold.oldParksEmail);
    await dynamodb.send(new UpdateItemCommand({
      TableName: CLAIM_TABLE_NAME,
      Key: { pk: { S: email } },
      UpdateExpression: 'SET #pending = :false',
      ConditionExpression: '#owner = :owner AND #source = :source AND #migrateId = :migrateId',
      ExpressionAttributeNames: {
        '#pending': 'migrateHoldPending',
        '#owner': 'owner',
        '#source': 'source',
        '#migrateId': 'migrateId',
      },
      ExpressionAttributeValues: {
        ':false': { BOOL: false },
        ':owner': { S: hold.oldParksUsername },
        ':source': { S: 'bcparks' },
        ':migrateId': { S: migrateId },
      },
    }));

    await cognito.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: PUBLIC_USER_POOL_ID,
      Username: hold.oldParksUsername,
      UserAttributes: [
        { Name: 'custom:migrationPending', Value: 'false' },
        { Name: 'custom:migrationId', Value: 'none' },
      ],
    }));

    await dynamodb.send(new UpdateItemCommand({
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: {
        pk: { S: 'migrateHold' },
        sk: { S: hold.sk },
      },
      UpdateExpression: 'REMOVE #tokenHash, #tokenExpiresAt',
      ConditionExpression: '#status = :confirmed AND #globalId = :migrateId',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#tokenHash': 'emailConfirmationTokenHash',
        '#tokenExpiresAt': 'emailConfirmationExpiresAt',
        '#globalId': 'globalId',
      },
      ExpressionAttributeValues: {
        ':confirmed': { S: 'confirmed' },
        ':migrateId': { S: migrateId },
      },
    }));

    return sendResponse(200, { status: 'confirmed' }, 'Migration confirmed. Sign out and sign in with BCSC to continue.', null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 500,
      error?.data || null,
      error?.message || 'Unable to confirm the migration.',
      error?.error || null,
      context,
    );
  }
};
