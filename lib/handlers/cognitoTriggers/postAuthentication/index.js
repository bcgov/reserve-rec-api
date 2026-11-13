const { logger } = require('/opt/base');
const {
  DynamoDBClient,
  GetItemCommand,
} = require('@aws-sdk/client-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { canonicalizeEmail } = require('/opt/emailBlocklist');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const CLAIM_TABLE = process.env.CLAIM_TABLE_NAME;

exports.handler = async (event) => {
  if (event?.triggerSource !== 'PostAuthentication_Authentication') return event;

  const username = event.userName;
  const email = canonicalizeEmail(event.request?.userAttributes?.email);
  if (!username || !email) return event;

  // Get the user from the claim table
  const result = await dynamodb.send(new GetItemCommand({
    TableName: CLAIM_TABLE,
    Key: { pk: { S: email } },
    ConsistentRead: true,
  }));
  if (!result.Item) return event;

  const claim = unmarshall(result.Item);

  // Don't care if they don't have a username or are BCSC already
  if (claim.owner !== username || claim.source !== 'bcparks') {
    return event;
  }

  // If they have a migrateHoldPending on the claim, then update their
  // Cognito user for the BC Parks with the migrationId
  const migrationPending = claim.migrateHoldPending === true && Boolean(claim.migrateId);
  const attributes = [{
    Name: 'custom:migrationPending',
    Value: String(migrationPending),
  }, {
    Name: 'custom:migrationId',
    Value: migrationPending ? claim.migrateId : 'none',
  }];
  const test = await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: event.userPoolId,
    Username: username,
    UserAttributes: attributes,
  }));

  logger.info('event=migration_pending_attribute_synced', {
    migrationPending,
  });
  return event;
};
