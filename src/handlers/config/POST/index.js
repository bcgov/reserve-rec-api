// Build the config items needed for the application and update them in the config table
const { logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Update Config Items Handler');
  try {
    await updateAdminConfigItem();
    return sendResponse(200, null, 'Config items updated successfully', null, context);
  } catch (error) {
    return sendResponse(500, null, 'Error updating config items', error.message, context);
  }
}

async function updateAdminConfigItem() {
  logger.debug('Updating admin config item');

  // Get parameters from SSM
  const params = process.env.PARAMS_TO_FETCH;

  const ssmValues = await getParameters(params)

  const adminConfig = {
    pk: 'config',
    sk: 'admin',
    ADMIN_IDENTITY_POOL_ID: process.env.ADMIN_IDENTITY_POOL_ID,
    ADMIN_USER_POOL_ID: process.env.ADMIN_USER_POOL_ID,
    ADMIN_USER_POOL_CLIENT_ID: process.env.ADMIN_USER_POOL_CLIENT_ID,
    API_LOCATION: `https://${process.env.ADMIN_API_URL}`,
  }
  logger.debug(`Admin Config: ${JSON.stringify(adminConfig)}`);
}