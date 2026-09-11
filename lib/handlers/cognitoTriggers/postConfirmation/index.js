const { logger, getNow } = require('/opt/base');
const { TRANSACTIONAL_DATA_TABLE_NAME, putItem, updateItem, getOne } = require('/opt/dynamodb');
const { canonicalizeEmail, loadBlocklist, refusalReason } = require('/opt/emailBlocklist');
const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');

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
 * Determine user status based on Cognito attributes
 * @param {string} userName - Cognito username
 * @returns {string} User status: 'EXTERNAL_PROVIDER' or 'CONFIRMED'
 */
function determineUserStatus(userName) {
  // Check if user authenticated via BCSC (BC Services Card)
  // BCSC users have usernames prefixed with 'BCSC_' by Cognito
  if (userName.startsWith('BCSC_')) {
    logger.info('User authenticated via BCSC', { userName });
    return 'EXTERNAL_PROVIDER';
  }
  
  // Native Cognito user
  return 'CONFIRMED';
}

/**
 * An account whose email no longer matches the one on record has changed it
 * since the last login. PreSignUp never sees that path, so a blocked address
 * can otherwise be reached by signing up clean and swapping afterwards.
 *
 * Refusal is gated by EMAIL_CHANGE_REFUSE (and EMAIL_CHANGE_REFUSE_BCSC for
 * federated accounts) so the detection can soak in the logs before it bites.
 * Both default off. The list load fails open, as in PreSignUp: a login must
 * not fail because SSM did.
 *
 * @param {string} sub
 * @param {'bcsc'|'native'} source
 * @param {string} newEmail
 */
async function checkEmailChange(sub, source, newEmail) {
  logger.info('event=email_changed', { sub, source });

  let reason = null;
  try {
    reason = refusalReason(newEmail, await loadBlocklist(process.env.BLOCKLIST_SSM_PARAM));
  } catch (err) {
    logger.error('PreTokenGeneration blocklist check failed open', { error: err.message });
    return;
  }
  if (!reason) return;

  logger.warn('event=email_change_refused', { sub, source, reason });

  const refuse = process.env.EMAIL_CHANGE_REFUSE === 'true'
    && (source === 'native' || process.env.EMAIL_CHANGE_REFUSE_BCSC === 'true');
  if (refuse) throw new EmailChangeRefused();
}

/**
 * Main handler for Pre Token Generation trigger
 * Fires on EVERY authentication (native + federated)
 * Creates user in DB on first login if they don't exist
 */
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
    
    // Extract and structure user data
    const userData = extractUserData(userAttributes);
    const now = getNow().toISO();
    
    // Determine user status (EXTERNAL_PROVIDER for federated, CONFIRMED for native Cognito)
    const userStatus = determineUserStatus(userName);

    // Cognito resets email_verified=false on every BCSC login when the email attribute
    // is synced from the IdP. Force it true here so fetchUserAttributes() returns the
    // correct value immediately after login.
    //
    // We detect BCSC federation via the `identities` attribute (Cognito-managed JSON),
    // not the username prefix, so native Cognito users cannot trigger this path.
    let isBcscUser = false;
    try {
      const identities = JSON.parse(userAttributes.identities || '[]');
      isBcscUser = Array.isArray(identities) && identities.some(id => id.providerName === 'BCSC');
    } catch {
      // Malformed identities — treat as non-federated
    }

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

    // Compare canonical forms so a plus-tag or Gmail dot shuffle is not
    // counted as a change. The update below stores the new value, so the next
    // login compares against the current address.
    if (existingUser && typeof existingUser.email === 'string' && existingUser.email
      && canonicalizeEmail(existingUser.email) !== canonicalizeEmail(userAttributes.email)) {
      await checkEmailChange(sub, isBcscUser ? 'bcsc' : 'native', userAttributes.email);
    }

    if (!existingUser) {
      // New user - create record with createdAt
      // First login for this subject, which is the nearest thing to a signup
      // signal available: there is no PostConfirmation trigger, and Cognito
      // owns the state of anyone who signs up but never returns.
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
          enabled: existingUser.enabled !== undefined ? existingUser.enabled : true,
          createdAt: existingUser.createdAt,
          lastLogin: now,
          lastModified: now,
          };

        logger.info('Updating user in DynamoDB:', { pk: dynamoItem.pk, sk: dynamoItem.sk, userStatus });
        await updateItem(dynamoItem, TRANSACTIONAL_DATA_TABLE_NAME);
        logger.info('User updated in DynamoDB successfully. Will be indexed via DynamoDB stream.');
    }

    // Return event - tokens will be generated normally
    return event;

  } catch (error) {
    // A refusal is the one error that must reach Cognito; it denies the login.
    if (error instanceof EmailChangeRefused) throw error;
    logger.error('Error in Pre Token Generation trigger:', error);
    // TODO: Retry??ALERT???? WHAT DO WE DO?! 
    return event;
  }
};

// ============================================================================
// ORIGINAL POST-CONFIRMATION VERSION (COMMENTED OUT FOR REFERENCE)
// Problem: Only fires for native Cognito users who confirm email/phone
// Does NOT fire for federated users (BCSC, social logins, SAML, OIDC)
// ============================================================================

// const { logger, getNow } = require('/opt/base');
// const { TRANSACTIONAL_DATA_TABLE_NAME, putItem } = require('/opt/dynamodb');

// /**
//  * Extract standard and custom attributes from Cognito user
//  * @param {Object} userAttributes - Cognito user attributes
//  * @returns {Object} Structured user data
//  */
// function extractUserData(userAttributes) {
//   const userData = {
//     // Standard attributes
//     sub: userAttributes.sub,
//     email: userAttributes.email || '',
//     email_verified: userAttributes.email_verified === 'true',
//     givenName: userAttributes.given_name || '',
//     familyName: userAttributes.family_name || '',
//     phoneNumber: userAttributes.phone_number || '',
//     phone_number_verified: userAttributes.phone_number_verified === 'true',
//     
//     // Custom attributes (match those defined in public-identity-stack)
//     mobilePhone: userAttributes['custom:mobilePhone'] || '',
//     postalCode: userAttributes['custom:postalCode'] || '',
//     province: userAttributes['custom:province'] || '',
//     streetAddress: userAttributes['custom:streetAddress'] || '',
//     licensePlate: userAttributes['custom:licensePlate'] || '',
//     vehicleRegLocale: userAttributes['custom:vehicleRegLocale'] || '',
//     secondaryNumber: userAttributes['custom:secondaryNumber'] || '',
//   };
//   
//   return userData;
// }

// /**
//  * Main handler for New User Registration (Cognito Post-Confirmation trigger)
//  */
// exports.handler = async (event, context) => {
//   logger.info('New User Registration Trigger:', JSON.stringify(event, null, 2));

//   try {
//     const { request, userName, userPoolId } = event;
//     const userAttributes = request.userAttributes;
//     
//     // Extract and structure user data
//     const userData = extractUserData(userAttributes);
//     const now = getNow().toISO();
//     
//     // Prepare DynamoDB item
//     const dynamoItem = {
//       pk: 'user',
//       sk: userData.sub,
//       schema: 'user',
//       username: userName,
//       userPoolId: userPoolId,
//       ...userData,
//       userStatus: 'CONFIRMED',
//       enabled: true,
//       createdAt: now,
//       lastModified: now,
//     };

//     logger.info('Writing user to DynamoDB:', { pk: dynamoItem.pk, sk: dynamoItem.sk });
//     await putItem(dynamoItem, TRANSACTIONAL_DATA_TABLE_NAME);
//     logger.info('User written to DynamoDB successfully. Will be indexed via DynamoDB stream.');

//     return event;

//   } catch (error) {
//     logger.error('Error in New User Registration trigger:', error);
//     // Note: Even on error, we return the event to avoid blocking Cognito
//     // TODO: Retry??ALERT???? WHAT DO WE DO?! 
//     return event;
//   }
// };
