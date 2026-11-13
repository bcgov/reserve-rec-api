const { randomBytes, createHash } = require('crypto');
const { Exception, logger, sendResponse } = require('/opt/base');
const {
  DynamoDBClient,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const {
  getOneByGlobalId,
  TRANSACTIONAL_DATA_TABLE_NAME,
} = require('/opt/dynamodb');
const { sendMigrationConfirmationEmail } = require('../../../../lib/handlers/emailDispatch/utils');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function frontendBaseUrl() {
  const configuredDomain = process.env.PUBLIC_FRONTEND_DOMAIN;
  if (!configuredDomain) {
    throw new Exception('PUBLIC_FRONTEND_DOMAIN is not configured', { code: 500 });
  }
  return /^https?:\/\//i.test(configuredDomain)
    ? configuredDomain.replace(/\/+$/, '')
    : `https://${configuredDomain.replace(/\/+$/, '')}`;
}

exports.handler = async (event, context) => {
  try {
    const migrateId = event?.pathParameters?.migrateId;
    if (typeof migrateId !== 'string' || !UUID_REGEX.test(migrateId)) {
      throw new Exception('A valid migrateId is required', { code: 400 });
    }

    const authorizer = event?.requestContext?.authorizer;
    if (authorizer?.isAuthenticated !== 'true' || !authorizer.username) {
      throw new Exception('Sign in to your BC Parks account to request migration.', { code: 401 });
    }

    const hold = await getOneByGlobalId(migrateId, TRANSACTIONAL_DATA_TABLE_NAME);
    if (!hold || hold.pk !== 'migrateHold' || hold.globalId !== migrateId || !hold.oldParksUsername) {
      throw new Exception('Migration request was not found or is invalid.', { code: 404 });
    }
    if (authorizer.username !== hold.oldParksUsername) {
      throw new Exception('Sign in to the BC Parks account associated with this migration.', { code: 403 });
    }
    if (hold.status !== 'pending') {
      throw new Exception('This migration can no longer be requested.', { code: 409 });
    }

    const now = Date.now();
    if (!Number.isFinite(hold.holdExpiry) || hold.holdExpiry <= now) {
      throw new Exception('This migration request has expired. Sign in with BCSC again to restart.', { code: 410 });
    }
    if (!hold.oldParksEmail) {
      throw new Exception('The BC Parks account email is unavailable.', { code: 409 });
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Update the hold with the token hash and expiration, and set the email sent timestamp
    try {
      await dynamodb.send(new UpdateItemCommand({
        TableName: TRANSACTIONAL_DATA_TABLE_NAME,
        Key: {
          pk: { S: 'migrateHold' },
          sk: { S: hold.sk },
        },
        UpdateExpression: 'SET #tokenHash = :tokenHash, #tokenExpiresAt = :tokenExpiresAt, #emailSentAt = :emailSentAt',
        ConditionExpression: '#status = :pending AND #holdExpiry > :now AND #globalId = :migrateId AND #oldParksUsername = :username',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#holdExpiry': 'holdExpiry',
          '#globalId': 'globalId',
          '#oldParksUsername': 'oldParksUsername',
          '#tokenHash': 'emailConfirmationTokenHash',
          '#tokenExpiresAt': 'emailConfirmationExpiresAt',
          '#emailSentAt': 'emailConfirmationSentAt',
        },
        ExpressionAttributeValues: {
          ':pending': { S: 'pending' },
          ':now': { N: String(now) },
          ':tokenHash': { S: tokenHash },
          ':tokenExpiresAt': { N: String(hold.holdExpiry) },
          ':emailSentAt': { N: String(now) },
          ':migrateId': { S: migrateId },
          ':username': { S: authorizer.username },
        },
      }));
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') {
        throw new Exception('This migration request has expired or changed. Sign in with BCSC again to restart.', { code: 409 });
      }
      throw error;
    }

    // Send the confirmation email with the token in the URL
    const confirmationUrl = new URL(`${frontendBaseUrl()}/migration-confirm`);
    confirmationUrl.hash = new URLSearchParams({ migrateId, token }).toString();
    await sendMigrationConfirmationEmail({
      recipientEmail: hold.oldParksEmail,
      recipientName: hold.oldParksName || '',
      confirmationUrl: confirmationUrl.toString(),
      migrateId,
    });

    return sendResponse(200, { status: 'email_sent' }, 'Check your email to confirm the migration.', null, context);
  } catch (error) {
    logger.error('Migration confirmation email request failed', { message: error?.message });
    return sendResponse(
      Number(error?.code) || 500,
      error?.data || null,
      error?.message || 'Unable to send the migration confirmation email.',
      error?.error || null,
      context,
    );
  }
};
