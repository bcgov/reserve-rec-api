const {
  BLOCKLIST_REASONS, canonicalizeEmail, loadBlocklist, phoneRefusalReason, refusalReason, emailDomain,
} = require('/opt/emailBlocklist');
const { logger } = require('/opt/base');
const { isValidPhoneNumber } = require('/opt/phone');
const { linkKeys } = require('/opt/signupLinks');
const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { randomUUID } = require('crypto');


const BLOCKLIST_TABLE = process.env.BLOCKLIST_TABLE_NAME;
const CLAIM_TABLE = process.env.CLAIM_TABLE_NAME;
const TRANS_TABLE = process.env.TRANSACTIONAL_DATA_TABLE_NAME;
const REFUSAL_TABLE = process.env.REFUSAL_TABLE_NAME;
const REFUSAL_TTL_SECONDS = 90 * 24 * 60 * 60;

const PHONE_ATTRIBUTES = ['custom:mobilePhone', 'custom:secondaryNumber'];
// Only the public sign-up form sends these; the hosted UI and a bare SignUp call do not.
const FORM_ATTRIBUTES = ['given_name', 'family_name', 'custom:mobilePhone'];

// Include PreSignUp_ExternalProvider so BCSC signups register and check claims.
const CLAIMABLE_SIGNUPS = new Set(['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser', 'PreSignUp_ExternalProvider']);
const NATIVE_SIGNUPS = new Set(['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']);
const TRIGGER_SOURCE_MAP = {
  'PreSignUp_SignUp': "bcparks",
  'PreSignUp_AdminCreateUser': "bcparks",
  'PreSignUp_ExternalProvider': "bcsc"
}

const isBcscSignup = (event) => event?.triggerSource === 'PreSignUp_ExternalProvider'
  && /^bcsc_/i.test(event?.userName || '');

const REFUSAL_MESSAGE = 'We could not complete your registration. Please contact support for assistance.';
const MIGRATE_PROMPT_MESSAGE = 'A BC Parks account with this email address already exists.';
const MIGRATION_REQUIRED_CODE = 'BCPARKS_MIGRATION_REQUIRED';
const DUPLICATE_EMAIL_MESSAGE = 'An account with this email address already exists. Sign in instead, or reset your password!';
const DUPLICATE_BCSC_EMAIL_MESSAGE = 'A BC Services Card (BCSC) with this email address already exists. Sign in through BCSC instead.';
const PHONE_MESSAGE = 'Enter a phone number with its area code, including a leading + for numbers outside Canada and the US.';
const INCOMPLETE_MESSAGE = 'Sign up at reserve.bcparks.ca to create an account.';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
let cognito;

// Flagged so the catch below tells a refusal from a fault without matching text.
class SignupRefused extends Error {
  constructor(message = REFUSAL_MESSAGE) {
    super(message);
    this.signupRefused = true;
  }
}

function signupFields(event, email) {
  return {
    domain: emailDomain(email),
    clientId: event?.callerContext?.clientId,
    triggerSource: event?.triggerSource,
  };
}

async function getMigrateHold(newUser) {
  return dynamodb.send(new GetItemCommand({
    TableName: TRANS_TABLE,
    Key: {
      pk: { S: 'migrateHold' },
      sk: { S: newUser },
    },
  }));
}

// Create a migrateHold
// If the migrateHold already exists, we overwrite it as long as it's in
// a "pending" or "confirmed" state (not yet "completed")
async function putMigrateHold(oldUsername, oldSub, newUser, migrateId, currentHold) {
  const now = Date.now();
  const replacingExpiredHold = currentHold?.status === 'pending' || currentHold?.status === 'confirmed';
  return dynamodb.send(new PutItemCommand({
    TableName: TRANS_TABLE,
    Item: {
      pk: { S: 'migrateHold' },
      sk: { S: newUser },
      status: { S: 'pending' },
      holdExpiry: { N: String(Date.now() + (3600 * 1000)) },
      globalId: { S: migrateId },
      oldParksSub: { S: oldSub },
      oldParksUsername: { S: oldUsername },
      newBcscUsername: { S: newUser },
    },
    ...(replacingExpiredHold
      ? {
          ConditionExpression: '#status = :status AND (attribute_not_exists(#holdExpiry) OR #holdExpiry <= :now)',
          ExpressionAttributeNames: { '#status': 'status', '#holdExpiry': 'holdExpiry' },
          ExpressionAttributeValues: {
            ':status': { S: currentHold.status },
            ':now': { N: String(now) },
          },
        }
      : { ConditionExpression: 'attribute_not_exists(pk)' }),
  }));
}

async function recordRefusal(event, email, reason) {
  const attributes = event?.request?.userAttributes || {};
  const now = new Date();
  const at = now.toISOString();
  const pk = event?.userName || canonicalizeEmail(email) || email;
  const expiresAt = { N: String(Math.floor(now.getTime() / 1000) + REFUSAL_TTL_SECONDS) };
  // Only a blocklist refusal links a later account; phone, form and mailbox refusals never do.
  const counted = BLOCKLIST_REASONS.includes(reason);
  const links = linkKeys({
    phones: PHONE_ATTRIBUTES.map((attribute) => attributes[attribute]),
    streetAddress: attributes['custom:streetAddress'],
    postalCode: attributes['custom:postalCode'],
  });
  const item = {
    pk: { S: pk },
    sk: { S: at },
    email: { S: canonicalizeEmail(email) || email },
    reason: { S: reason },
    counted: { BOOL: counted },
    expiresAt,
  };
  if (attributes.given_name) item.givenName = { S: attributes.given_name };
  if (attributes.family_name) item.familyName = { S: attributes.family_name };
  const phones = links.filter(({ matchedOn }) => matchedOn === 'phone').map(({ value }) => value);
  const address = links.find(({ matchedOn }) => matchedOn === 'address');
  if (phones.length) item.phones = { SS: phones };
  if (address) item.address = { S: address.value };
  const items = [item];
  if (counted) {
    for (const link of links) {
      items.push({
        pk: { S: link.pk },
        sk: { S: `${at}#${pk}` },
        source: { S: 'refusal' },
        ref: { S: pk },
        reason: { S: reason },
        expiresAt,
      });
    }
  }
  try {
    await Promise.all(items.map((Item) => dynamodb.send(new PutItemCommand({ TableName: REFUSAL_TABLE, Item }))));
  } catch (err) {
    logger.error('PreSignUp refusal record failed', { error: err.message });
  }
}

async function refuse(event, email, reason, message = REFUSAL_MESSAGE) {
  const fields = {
    reason,
    ...signupFields(event, email),
    localPart: canonicalizeEmail(email)?.split('@')[0],
  };
  // The provider id or userName is the identity back to the account.
  if (!NATIVE_SIGNUPS.has(event?.triggerSource)) fields.identity = event?.userName;
  logger.info('event=signup_refused', fields);
  if (email) await recordRefusal(event, email, reason);
  throw new SignupRefused(message);
}

/**
 * Conditional put of the claim on a canonical mailbox.
 * Stores the actual Cognito userName (e.g. bcparks/native Cognito UUID or 'bcsc_xxxx') as the owner.
 *
 * @returns {Promise<{written: boolean, owner?: string, holder?: string}>}
 */
async function putClaim(pk, email, userName, source, staleClaim) {
  let condition = 'attribute_not_exists(pk)';
  const values = {};
  const names = {};

  if (staleClaim?.owner) {
    condition += ' OR #owner = :staleOwner';
    values[':staleOwner'] = { S: staleClaim.owner };
    names['#owner'] = 'owner';
  } else if (staleClaim?.legacyEmail) {
    condition += ' OR (attribute_not_exists(#owner) AND #email = :staleEmail)';
    values[':staleEmail'] = { S: staleClaim.legacyEmail };
    names['#owner'] = 'owner';
    names['#email'] = 'email';
  }

  try {
    await dynamodb.send(new PutItemCommand({
      TableName: CLAIM_TABLE,
      Item: {
        pk: { S: pk },
        email: { S: email },
        owner: { S: userName },
        source: { S: source },
        claimedAt: { S: new Date().toISOString() },
      },
      ConditionExpression: condition,
      ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values }),
      ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    }));
    return { written: true };
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;

    const item = err.Item || err.CancellationReasons?.[0]?.Item || {};

    return {
      written: false,
      owner: item.owner?.S || item.owner,
      holder: item.email?.S || item.email,
      source: item.source?.S || item.source,
    };
  }
}

// Checks if a user exists in Cognito by their exact username/identity.
// Handles both bcparks/native Cognito UUIDs and federated provider usernames (e.g., 'bcsc_xxxx').
async function getAccount(userPoolId, username) {
  if (!username) return null;
  // Required on first conflict only: most signups never need it, and a cold
  // start counts against Cognito's five seconds.
  cognito ||= new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
  try {
    return await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
  } catch (err) {
    if (err.name === 'UserNotFoundException') return null;
    throw err;
  }
}

/**
 * One account per canonical mailbox across bcparks/native Cognito and BCSC signups.
 * Cognito rejects only an exact duplicate, so a
 * plus-tag or a Gmail dot mints another account on an inbox that already has
 * one, and with it another set of per-account booking limits.
 *
 * A claim whose holder no longer exists is stale (a signup this trigger passed
 * and Cognito then failed, or a deleted user) and is taken over.
 */
async function claimMailbox(event, email, triggerSource) {
  const canonical = canonicalizeEmail(email);
  if (!canonical) return;
  const address = email.trim().toLowerCase();
  const username = event?.userName || event?.username; // Native Cognito GUID or BCSC identifier (e.g. bcsc_123)

  // Initial attempt to write claim
  const claim = await putClaim(canonical, address, username, triggerSource);
  if (claim.written) {
    return;
  }

  const claimOwner = claim.owner || claim.holder;
  const claimSource = claim.source || (claim.holder ? 'bcparks' : undefined);

  if (claimOwner && username
    && claimOwner.toLowerCase() === username.toLowerCase()
    && claimSource === triggerSource) return;

  // Check if the existing claim's owner actually exists in Cognito
  const existingOwner = await getAccount(event.userPoolId, claimOwner);

  // Take over stale claim if previous user registration failed or was deleted
  if (!existingOwner && claimOwner) {
    const staleClaim = claim.owner
      ? { owner: claim.owner }
      : { legacyEmail: claim.holder };
    const retryClaim = await putClaim(canonical, address, username, triggerSource, staleClaim);
    if (retryClaim.written) {
      return;
    }
  }

  // If the user already exists and the triggerSource is bcsc while the claim is bcparks.
  // then we want to initiate a migrateHold and prompt the user
  if (existingOwner && triggerSource === 'bcsc' && claimSource === 'bcparks') {
    const parksSub = existingOwner.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
    if (!parksSub) {
      logger.error('BC Parks account is missing its Cognito sub');
      await refuse(event, email, 'migration_hold_unavailable', MIGRATE_PROMPT_MESSAGE);
    }
    const bcscUser = event?.userName; // bcsc username !== sub

    let holdData;

    // Check for a migrateHold that might already exist
    try {
      const migrateHold = await getMigrateHold(bcscUser);
      holdData = migrateHold?.Item ? unmarshall(migrateHold.Item) : null;
    } catch (error) {
      logger.error('Migration hold lookup failed', { error: error.message });
      await refuse(event, email, 'migration_hold_unavailable', MIGRATE_PROMPT_MESSAGE);
    }

    const holdExpired = !Number.isFinite(holdData?.holdExpiry) || holdData.holdExpiry <= Date.now();
    if (!holdData || (holdExpired && ['pending', 'confirmed'].includes(holdData.status))) {
      // Create/update a new migrateHold if one doesn't already exist, isn't expired, and
      // is not yet "completed" (may be "confirmed", but not finished yet)
      const migrateId = randomUUID();
      let activeMigrateId = migrateId;
      try {
        await putMigrateHold(claimOwner, parksSub, bcscUser, migrateId, holdData);
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
          try {
            const latestHold = await getMigrateHold(bcscUser);
            const latestData = latestHold?.Item ? unmarshall(latestHold.Item) : null;
            if (latestData?.status === 'pending'
              && latestData.holdExpiry > Date.now()
              && latestData.globalId) {
              activeMigrateId = latestData.globalId;
            } else {
              await refuse(event, email, 'migration_hold_unavailable', MIGRATE_PROMPT_MESSAGE);
            }
          } catch (lookupError) {
            if (lookupError.signupRefused) throw lookupError;
            logger.error('Migration hold recovery lookup failed', { error: lookupError.message });
            await refuse(event, email, 'migration_hold_unavailable', MIGRATE_PROMPT_MESSAGE);
          }
        } else {
          logger.error('Migration hold creation failed', { error: error.message });
          await refuse(event, email, 'migration_hold_unavailable', MIGRATE_PROMPT_MESSAGE);
        }
      }
      // Send back a refusal, but append the migrationId so that the auth.service.ts will send
      // the user to the /migrate prompt page
      await refuse(
        event,
        email,
        'duplicate_prompt',
        `${MIGRATE_PROMPT_MESSAGE}$${MIGRATION_REQUIRED_CODE}:${activeMigrateId}`,
      );
    }

    // Send back a refusal, but append the migrationId so that the auth.service.ts will send
    // the user to the /migrate prompt page with the ID to confirm or cancel the migration
    if (holdData.status === 'pending' && holdData.globalId && !holdExpired) {
      await refuse(
        event,
        email,
        'duplicate_prompt',
        `${MIGRATE_PROMPT_MESSAGE}$${MIGRATION_REQUIRED_CODE}:${holdData.globalId}`,
      );
    }

    // User has confirmed - continue through preSignUp and initiate the migration
    // in the AccountConfirmed Cognito trigger
    if (holdData.status === 'confirmed' && !holdExpired) {
      return event;
    }

    // Migration is complete
    if (holdData.status === 'completed') {
      return event;
    }
  }

  if (process.env.DUPLICATE_EMAIL_REFUSE !== 'true') {
    logger.info('event=signup_duplicate', signupFields(event, email));
    return;
  }

  // Default "this user already exists" prompt
  if (claimSource === 'bcsc') {
    await refuse(event, email, 'duplicate', DUPLICATE_BCSC_EMAIL_MESSAGE);
  }
  await refuse(event, email, 'duplicate', DUPLICATE_EMAIL_MESSAGE);
}

/**
 * Cognito PreSignUp trigger. Throwing rejects the signup.
 */
exports.handler = async (event) => {
  logger.debug('PreSignUp trigger', {
    userPoolId: event?.userPoolId,
    triggerSource: event?.triggerSource,
  });

  const email = event?.request?.userAttributes?.email;

  if (email) {
    try {
      const blocklist = await loadBlocklist(BLOCKLIST_TABLE);
      const reason = refusalReason(email, blocklist)
        || PHONE_ATTRIBUTES.map((attribute) => phoneRefusalReason(event?.request?.userAttributes?.[attribute], blocklist)).find(Boolean);
      if (reason && isBcscSignup(event)) {
        logger.info('event=signup_flagged', { reason, ...signupFields(event, email), identity: event.userName });
      } else if (reason) {
        await refuse(event, email, reason);
      }
    } catch (err) {
      // A refusal must propagate; an infrastructure fault must not take
      // registration down with it.
      if (err.signupRefused) throw err;
      logger.error('PreSignUp blocklist check failed open', { error: err.message });
    }
  }

  // A number no SMS can reach is refused here rather than stored and skipped
  // at reminder time, where the only trace is a warn log nobody reads
  // (bcgov/reserve-rec-public#888). Empty is left alone: BCSC accounts arrive
  // without a number and add one in account settings, and the sign-up form
  // already requires its own.
  for (const attribute of PHONE_ATTRIBUTES) {
    const value = event?.request?.userAttributes?.[attribute];
    if (value && !isValidPhoneNumber(value)) {
      // The shape, never the number: enough to tell a mistyped number from one
      // whose leading + was stripped before it arrived.
      const digits = String(value).replace(/\D/g, '');
      logger.info('event=signup_phone_refused', {
        attribute,
        digits: digits.length,
        hasPlus: String(value).trim().startsWith('+'),
        last2: digits.slice(-2),
      });
      await refuse(event, email, 'phone', PHONE_MESSAGE);
    }
  }

  // After the blocklist and phone checks, so those refusals keep their own reason.
  if (event?.triggerSource === 'PreSignUp_SignUp'
    && FORM_ATTRIBUTES.some((attribute) => !String(event?.request?.userAttributes?.[attribute] ?? '').trim())) {
    await refuse(event, email, 'incomplete', INCOMPLETE_MESSAGE);
  }

  // Claims mailbox for both Native and BCSC signups
  if (email && (event?.triggerSource !== 'PreSignUp_ExternalProvider' || isBcscSignup(event))
    && CLAIMABLE_SIGNUPS.has(event?.triggerSource)) {
    try {
      // simplify triggerSource to bcparks or bcsc
      const triggerSource = TRIGGER_SOURCE_MAP[event.triggerSource]
      await claimMailbox(event, email, triggerSource);
    } catch (err) {
      if (err.signupRefused) throw err;
      logger.error('PreSignUp mailbox claim failed open', { error: err.message });
    }
  }

  return event;
};

exports.refusalReason = refusalReason;
