const { getOne, REFERENCE_DATA_TABLE_NAME } = require('/opt/dynamodb');
const { sendResponse, logger } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.debug('Get Feature Flags (admin)', event);
  
  // Handle CORS preflight
  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    const configItem = await getOne('config', 'featureFlags', REFERENCE_DATA_TABLE_NAME);
    
    // Return full record including metadata
    const response = {
      flags: configItem?.flags || { enablePayments: true },
      metadata: configItem?.metadata || null,
      version: configItem?.version || 0
    };
    
    return sendResponse(200, response, 'Success', null, context);
  } catch (error) {
    logger.error('Error fetching feature flags (admin)', error);
    return sendResponse(
      Number(error?.code) || 400,
      null,
      error?.message || 'Error',
      error?.error || error,
      context
    );
  }
};
