/**
 * @api {get} /protectedArea/{orcs} GET
 * Fetch single protected area by ORCS
 */

const { getProtectedAreaByOrcs } = require('/opt/protectedAreas')
const { logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get single Protected Area', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    const orcs = event?.pathParameters?.orcs;

    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    const res = await getProtectedAreaByOrcs(orcs);
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};