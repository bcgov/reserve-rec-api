const { getOne } = require('/opt/dynamodb');
const { requestIdentity, sendResponse, logger } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.debug('Read Config', requestIdentity(event));

  try {
    const configItem = await getOne('config', 'public');
    return sendResponse(200, configItem, 'Success', null, context);
  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};