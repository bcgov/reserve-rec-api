const { logger, getNow } = require('/opt/base');
const { TRANSACTIONAL_DATA_TABLE_NAME, putItem, updateItem, getOne } = require('/opt/dynamodb');

/**
 * Extract standard and custom attributes from Cognito user
 * @param {Object} userAttributes - Cognito user attributes
 * @returns {Object} Structured user data
 */
function extractUserData(userAttributes) {
  const userData = {
    // Standard attributes
    sub: userAttributes.sub,
    email: userAttributes.email || '',
    email_verified: userAttributes.email_verified === 'true',
    givenName: userAttributes.given_name || '',
    familyName: userAttributes.family_name || '',
    phoneNumber: userAttributes.phone_number || '',
    phone_number_verified: userAttributes.phone_number_verified === 'true',
    
    // Custom attributes (match those defined in public-identity-stack)
    mobilePhone: userAttributes['custom:mobilePhone'] || '',
    postalCode: userAttributes['custom:postalCode'] || '',
    province: userAttributes['custom:province'] || '',
    streetAddress: userAttributes['custom:streetAddress'] || '',
    licensePlate: userAttributes['custom:licensePlate'] || '',
    vehicleRegLocale: userAttributes['custom:vehicleRegLocale'] || '',
    secondaryNumber: userAttributes['custom:secondaryNumber'] || '',
  };
  
  return userData;
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
 * Main handler for Pre Token Generation trigger
 * Fires on EVERY authentication (native + federated)
 * Creates user in DB on first login if they don't exist
 */
exports.handler = async (event, context) => {
  logger.info('Pre Token Generation Trigger:', JSON.stringify(event, null, 2));

  try {
    const { request, userName, userPoolId } = event;
    const userAttributes = request.userAttributes;
    const sub = userAttributes.sub;
    
    // Extract and structure user data
    const userData = extractUserData(userAttributes);
    const now = getNow().toISO();
    
    // Determine user status (EXTERNAL_PROVIDER for federated, CONFIRMED for native Cognito)
    const userStatus = determineUserStatus(userName);
    
    const existingUser = await checkUserExists(sub);
    
    if (!existingUser) {
      // New user - create record with createdAt
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