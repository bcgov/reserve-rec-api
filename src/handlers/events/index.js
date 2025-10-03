const { sendResponse, logger } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info(`Event: ${JSON.stringify(event)}`);

  const msg = 'stuff happening'
  try{
    return sendResponse(200, msg, 'Success', null, context);
  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};