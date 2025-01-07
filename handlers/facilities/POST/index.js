/**
 * @api {POST} /facilities POST
 * Create new facilities
 */

const { postFacility } = require('/opt/facilities/methods');
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Post Facility', event);
  try {

    const body = JSON.parse(event?.body) || {};
    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || body?.orcs ||null;
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || body?.facilityType || null;

    console.log('orcs:', orcs);
    console.log('facilityType:', facilityType);
    console.log('body:', body);

    if (!orcs || !facilityType) {
      throw new Exception('ORCS and facilityType are required', { code: 400 });
    }

    const res = await postFacility(orcs, facilityType, body);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};