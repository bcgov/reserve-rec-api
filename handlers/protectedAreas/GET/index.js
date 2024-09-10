/**
 * @api {get} /protectedAreas GET
 * Fetch all protected areas
 */

const { getProtectedAreas } = require('/opt/protectedAreas');
const { logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get Protected Areas', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    const res = await getProtectedAreas(event?.queryStringParameters || null);
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};