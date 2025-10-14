const { sendResponse, logger } = require('/opt/base');

const apiName = process.env.API_NAME || 'Api';
console.log('process.env:', process.env);

exports.handler = async (event, context) => {
  logger.debug(`Event: ${JSON.stringify(event)}`);
  try{
    return sendResponse(200, `${apiName} ping success.`, 'Success', null, context);
  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};