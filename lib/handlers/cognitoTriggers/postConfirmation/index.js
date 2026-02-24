
const { logger, getNow } = require('/opt/base');
const { TRANSACTIONAL_DATA_TABLE_NAME, putItem } = require('/opt/dynamodb');

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
 * Main handler for New User Registration (Cognito Post-Confirmation trigger)
 */
exports.handler = async (event, context) => {
  logger.info('New User Registration Trigger:', JSON.stringify(event, null, 2));

  try {
    const { request, userName, userPoolId } = event;
    const userAttributes = request.userAttributes;
    
    // Extract and structure user data
    const userData = extractUserData(userAttributes);
    const now = getNow().toISO();
    
    // Prepare DynamoDB item
    const dynamoItem = {
      pk: 'user',
      sk: userData.sub,
      schema: 'user',
      username: userName,
      userPoolId: userPoolId,
      ...userData,
      userStatus: 'CONFIRMED',
      enabled: true,
      createdAt: now,
      lastModified: now,
    };

    logger.info('Writing user to DynamoDB:', { pk: dynamoItem.pk, sk: dynamoItem.sk });
    await putItem(dynamoItem, TRANSACTIONAL_DATA_TABLE_NAME);
    logger.info('User written to DynamoDB successfully. Will be indexed via DynamoDB stream.');

    return event;

  } catch (error) {
    logger.error('Error in New User Registration trigger:', error);
    // Note: Even on error, we return the event to avoid blocking Cognito
    // TODO: Retry??ALERT???? WHAT DO WE DO?! 
    return event;
  }
};
