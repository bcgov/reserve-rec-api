const { logger } = require('/opt/base');
const { canonicalizeEmail, loadBlocklist, refusalReason, emailDomain } = require('/opt/emailBlocklist');
const { isValidPhoneNumber } = require('/opt/phone');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const BLOCKLIST_TABLE = process.env.BLOCKLIST_TABLE_NAME;
const CLAIM_TABLE = process.env.CLAIM_TABLE_NAME;

const PHONE_ATTRIBUTES = ['custom:mobilePhone', 'custom:secondaryNumber'];

// BCSC arrives as PreSignUp_ExternalProvider and is out of scope for the claim.
const NATIVE_SIGNUPS = new Set(['PreSignUp_SignUp', 'PreSignUp_AdminCreateUser']);

const REFUSAL_MESSAGE = 'We could not complete your registration. Please contact support for assistance.';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
let cognito;

// Flagged so the catch below tells a refusal from a fault without matching text.
class SignupRefused extends Error {
  constructor() {
    super(REFUSAL_MESSAGE);
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

function refuse(event, email, reason) {
  const fields = {
    reason,
    ...signupFields(event, email),
    localPart: canonicalizeEmail(email)?.split('@')[0],
  };
  // The provider id is the only way back to a federated account.
  if (!NATIVE_SIGNUPS.has(event?.triggerSource)) fields.identity = event?.userName;
  logger.info('event=signup_refused', fields);
  throw new SignupRefused();
}

/**
 * Conditional put of the claim on a canonical mailbox.
 * @returns {Promise<{written: boolean, holder?: string}>} holder is the address
 *   on the claim that blocked the write
 */
async function putClaim(pk, email, staleHolder) {
  const values = { ':email': { S: email } };
  let condition = 'attribute_not_exists(pk) OR email = :email';
  if (staleHolder) {
    condition += ' OR email = :stale';
    values[':stale'] = { S: staleHolder };
  }
  try {
    await dynamodb.send(new PutItemCommand({
      TableName: CLAIM_TABLE,
      Item: { pk: { S: pk }, email: { S: email }, claimedAt: { S: new Date().toISOString() } },
      ConditionExpression: condition,
      ExpressionAttributeValues: values,
      // Returns the blocking claim, so a new mailbox costs one call rather than a read and a write.
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    }));
    return { written: true };
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    return { written: false, holder: err.Item?.email?.S };
  }
}

// Any status counts, UNCONFIRMED included: its code went to the same inbox, so
// letting a second through would let both be confirmed.
async function accountExists(userPoolId, username) {
  // Required on first conflict only: most signups never need it, and a cold
  // start counts against Cognito's five seconds.
  const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
  cognito ||= new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }));
    return true;
  } catch (err) {
    if (err.name === 'UserNotFoundException') return false;
    throw err;
  }
}

/**
 * One account per mailbox. Cognito rejects only an exact duplicate, so a
 * plus-tag or a Gmail dot mints another account on an inbox that already has
 * one, and with it another set of per-account booking limits.
 *
 * A claim whose holder no longer exists is stale (a signup this trigger passed
 * and Cognito then failed, or a deleted user) and is taken over.
 */
async function claimMailbox(event, email) {
  const canonical = canonicalizeEmail(email);
  if (!canonical) return;
  const address = email.trim().toLowerCase();

  const claim = await putClaim(canonical, address);
  if (claim.written) return;

  if (!(await accountExists(event.userPoolId, claim.holder))) {
    // Losing this write means a concurrent signup took the mailbox first.
    if ((await putClaim(canonical, address, claim.holder)).written) return;
  }

  if (process.env.DUPLICATE_EMAIL_REFUSE !== 'true') {
    logger.info('event=signup_duplicate', signupFields(event, email));
    return;
  }
  refuse(event, email, 'duplicate');
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
      const reason = refusalReason(email, blocklist);
      if (reason) refuse(event, email, reason);
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
      throw new Error('Enter a phone number with its area code, including a leading + for numbers outside Canada and the US.');
    }
  }

  // Last, so a signup refused for any other reason leaves no claim behind.
  if (email && NATIVE_SIGNUPS.has(event?.triggerSource)) {
    try {
      await claimMailbox(event, email);
    } catch (err) {
      if (err.signupRefused) throw err;
      logger.error('PreSignUp mailbox claim failed open', { error: err.message });
    }
  }

  return event;
};

exports.refusalReason = refusalReason;
