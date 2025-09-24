const { getOne } = require('/opt/dynamodb');
const { sendResponse, logger } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.debug('Read Config', event);
  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }
  try {

    // assume public config if not specified
    const configType = event.queryStringParameters?.config || 'public';

    const configItem = await getOne('config', configType);
    return sendResponse(200, configItem, 'Success', null, context);
  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};