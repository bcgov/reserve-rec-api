const { logger, getNow } = require('/opt/base');
const { TRANSACTIONAL_DATA_TABLE_NAME, putItem, updateItem, getOne } = require('/opt/dynamodb');
const { canonicalizeEmail, loadBlocklist, refusalReason } = require('/opt/emailBlocklist');
const { findLink, linkKeys } = require('/opt/signupLinks');
const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { userCountry } = require('./userCountry');

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

// Same shape as the PreSignUp refusal: one message whichever rule fired, and
// it names support because a real person caught here needs a way back.
const EMAIL_CHANGE_REFUSAL = 'This account cannot be used. Contact support if you believe this is an error.';

class EmailChangeRefused extends Error {
  constructor() {
    super(EMAIL_CHANGE_REFUSAL);
    this.name = 'EmailChangeRefused';
  }
}

/**
 * Extract standard and custom attributes from Cognito user
 * @param {Object} userAttributes - Cognito user attributes
 * @returns {Object} Structured user data
 */
function extractUserData(userAttributes = {}) {
  // Safe parsing for address coming from BCSC
  // e.g. address: '{"street_address":"8550 YOUNG ROAD","locality":"CHILLIWACK","region":"BC","postal_code":"V2P 8A4","country":"CA"}'
  let address = {};
  if (typeof userAttributes?.address === 'string') {
    try {
      address = JSON.parse(userAttributes.address);
    } catch (e) {
      console.warn('Failed to parse user address JSON:', e);
    }
  } else if (typeof userAttributes?.address === 'object' && userAttributes.address !== null) {
    address = userAttributes.address;
  }

  return {
    // Standard attributes
    sub: userAttributes?.sub,
    email: userAttributes?.email || '',
    email_verified: userAttributes?.email_verified === 'true',
    givenName: userAttributes?.given_name || '',
    familyName: userAttributes?.family_name || '',
    phoneNumber: userAttributes?.phone_number || '',
    phone_number_verified: userAttributes?.phone_number_verified === 'true',

    // Custom attributes (match those defined in public-identity-stack)
    mobilePhone: userAttributes?.['custom:mobilePhone'] || '',
    city: userAttributes?.['custom:city'] || address.locality || '',
    postalCode: userAttributes?.['custom:postalCode'] || address.postal_code || '',
    province: userAttributes?.['custom:province'] || address.region || '',
    country: userCountry(userAttributes, address),
    streetAddress: userAttributes?.['custom:streetAddress'] || address.street_address || '',
    licensePlate: userAttributes?.['custom:licensePlate'] || '',
    vehicleRegLocale: userAttributes?.['custom:vehicleRegLocale'] || '',
    secondaryNumber: userAttributes?.['custom:secondaryNumber'] || '',
  };
}

/**
 * Check if user already exists in DynamoDB
 * @param {string} sub - User's Cognito sub
 * @returns {Promise<Object|null>} User object if exists, null otherwise
 */
  async function checkUserExists(sub) {
    try {
      const result = await getOne('user', sub, TRANSACTIONAL_DATA_TABLE_NAME);
      return result;
    } catch (error) {
      logger.error('Error checking if user exists:', error);
      return null;
    }
  }

/**
 * PreSignUp never sees an email change after signup, so a blocked address could
 * be swapped in later. Refusal only happens when EMAIL_CHANGE_REFUSE is 'true'.
 *
 * @param {string} sub
 * @param {'bcsc'|'native'} source
 * @param {string} newEmail
 */
async function checkEmailChange(sub, source, newEmail) {
  logger.info('event=email_changed', { sub, source });
  if (source === 'bcsc') return;

  let reason = null;
  try {
    reason = refusalReason(newEmail, await loadBlocklist(process.env.BLOCKLIST_TABLE_NAME));
  } catch (err) {
    logger.error('PreTokenGeneration blocklist check failed open', { error: err.message });
    return;
  }
  if (!reason) return;

  logger.warn('event=email_change_refused', { sub, source, reason });

  if (process.env.EMAIL_CHANGE_REFUSE === 'true') throw new EmailChangeRefused();
}

/**
 * A new native account whose phone or address matches a counted refusal or a
 * banned account starts in review.
 */
async function linkedReview(sub, userData, now) {
  let link;
  try {
    link = await findLink(process.env.REFUSAL_TABLE_NAME, linkKeys({
      phones: [userData.mobilePhone, userData.secondaryNumber],
      streetAddress: userData.streetAddress,
      postalCode: userData.postalCode,
    }), Date.parse(now));
  } catch (err) {
    logger.error('PreTokenGeneration link check failed open', { error: err.message });
    return {};
  }
  if (!link) return {};

  logger.info('event=account_flagged', { sub, source: link.source, matchedOn: link.matchedOn });
  return { review: { state: 'pending', source: link.source, matchedOn: link.matchedOn, linkedTo: link.ref, at: now } };
}

/** Review fields this login sets; any already stored are left to the record. */
async function reviewFields(existingUser, { isBcscUser, emailChanged, sub, email, now, userData }) {
  if (!isBcscUser && !existingUser) return linkedReview(sub, userData, now);
  if (!isBcscUser || (existingUser?.reviewFlaggedAt && !emailChanged)) return {};

  let reason;
  try {
    reason = refusalReason(email, await loadBlocklist(process.env.BLOCKLIST_TABLE_NAME));
  } catch (err) {
    logger.error('PreTokenGeneration review check failed open', { error: err.message });
    return {};
  }
  if (!reason) return {};

  logger.info('event=account_flagged', { sub, reason });
  return { reviewFlag: true, reviewReason: reason, reviewFlaggedAt: now };
}

/** Pre Token Generation handler: fires on every login, native and federated, and creates the user on first login. */
exports.handler = async (event, context) => {
  // The whole event carries every Cognito attribute — email, name, phone —
  // and this log group keeps two years. Identify the trigger, not the person.
  logger.debug('Pre Token Generation Trigger', {
    userPoolId: event?.userPoolId,
    triggerSource: event?.triggerSource,
  });

  try {
    const { request, userName, userPoolId } = event;
    const userAttributes = request.userAttributes;
    const sub = userAttributes.sub;

    const userData = extractUserData(userAttributes);
    const now = getNow().toISO();

    // Cognito resets email_verified=false on every BCSC login; force it true so fetchUserAttributes() is right at once.
    // BCSC is detected from the Cognito-managed `identities`, not the username prefix, so native users cannot trigger it.
    let isBcscUser = false;
    try {
      const identities = JSON.parse(userAttributes.identities || '[]');
      isBcscUser = Array.isArray(identities) && identities.some(id => id.providerName === 'BCSC');
    } catch {
      // Malformed identities — treat as non-federated
    }
    const userStatus = isBcscUser ? 'EXTERNAL_PROVIDER' : 'CONFIRMED';

    if (isBcscUser && userAttributes.email_verified !== 'true') {
      try {
        await cognitoClient.send(new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: userName,
          UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
        }));
        logger.info('Forced email_verified=true for BCSC user', { userName });
      } catch (err) {
        logger.error('Failed to set email_verified for BCSC user:', err.message);
        // Non-fatal — don't block login
      }
    }

    const existingUser = await checkUserExists(sub);

    // Compare canonical forms so a plus-tag or Gmail dot shuffle is not a change.
    const emailChanged = Boolean(existingUser && typeof existingUser.email === 'string' && existingUser.email
      && canonicalizeEmail(existingUser.email) !== canonicalizeEmail(userAttributes.email));
    if (emailChanged) {
      await checkEmailChange(sub, isBcscUser ? 'bcsc' : 'native', userAttributes.email);
    }
    const review = await reviewFields(existingUser, { isBcscUser, emailChanged, sub, email: userAttributes.email, now, userData });

    if (!existingUser) {
      // First login is the nearest signup signal: there is no PostConfirmation trigger.
      logger.info('event=account_created', {
        sub,
        userStatus,
        emailVerified: userAttributes?.email_verified === 'true',
        identityType: userAttributes?.identities ? 'federated' : 'native',
      });
      logger.info('User not found in DB. Creating new user record.', { sub, userName });
      
      const dynamoItem = {
        pk: 'user',
        sk: userData.sub,
        schema: 'user',
        username: userName,
        userPoolId: userPoolId,
        ...userData,
        userStatus: userStatus,
        ...review,
        enabled: true,
        createdAt: now,
        lastLogin: now,
        lastModified: now,
      };

      logger.info('Writing new user to DynamoDB:', { pk: dynamoItem.pk, sk: dynamoItem.sk, userStatus });
      await putItem(dynamoItem, TRANSACTIONAL_DATA_TABLE_NAME);
      logger.info('User written to DynamoDB successfully. Will be indexed via DynamoDB stream.');
    } else {
        const dynamoItem = {
          pk: 'user',
          sk: userData.sub,
          schema: 'user',
          username: userName,
          userPoolId: userPoolId,
          ...userData,
          userStatus: userStatus,
          ...review,
          ...(existingUser.enabled === undefined ? { enabled: true } : {}),
          lastLogin: now,
          lastModified: now,
          };

        logger.info('Updating user in DynamoDB:', { pk: dynamoItem.pk, sk: dynamoItem.sk, userStatus });
        await updateItem(dynamoItem, TRANSACTIONAL_DATA_TABLE_NAME);
        logger.info('User updated in DynamoDB successfully. Will be indexed via DynamoDB stream.');
    }

    return event;

  } catch (error) {
    // A refusal is the one error that must reach Cognito; it denies the login.
    if (error instanceof EmailChangeRefused) throw error;
    logger.error('Error in Pre Token Generation trigger:', error);
    // TODO: Retry??ALERT???? WHAT DO WE DO?! 
    return event;
  }
};
