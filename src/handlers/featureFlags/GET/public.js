const { getOne, REFERENCE_DATA_TABLE_NAME } = require('/opt/dynamodb');
const { sendResponse, logger } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.debug('Get Feature Flags', event);
  
  // Handle CORS preflight
  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  // Check if admin response is requested
  const isAdminRequest = event?.queryStringParameters?.admin === 'true';

  try {
    const configItem = await getOne('config', 'featureFlags', REFERENCE_DATA_TABLE_NAME);
    
    if (isAdminRequest) {
      // Admin request: return full record including metadata
      const response = {
        flags: configItem?.flags || { enablePayments: true },
        metadata: configItem?.metadata || null,
        version: configItem?.version || 0
      };
      return sendResponse(200, response, 'Success', null, context);
    }
    
    // Public request: return only the flags object, not metadata
    // Default to enablePayments: true if record doesn't exist yet
    const flags = configItem?.flags || { enablePayments: true };
    return sendResponse(200, flags, 'Success', null, context);
  } catch (error) {
    logger.error('Error fetching feature flags', error);
    // On error, return default flags so app can still function
    return sendResponse(200, { enablePayments: true }, 'Success (defaults)', null, context);
  }
};
