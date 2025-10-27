const { getOne } = require('/opt/dynamodb');
const { sendResponse, logger } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.debug('Read Config', event);

  try {
    const configItem = await getOne('config', 'admin');
    return sendResponse(200, configItem, 'Success', null, context);
  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};