/**
 * Get Places
 */

const { Exception, sendResponse, logger } = require('/opt/base');
const { getPlaces } = require('/opt/places/methods');

exports.handler = async (event, context) => {
  logger.info('Get Places', event);

  try {

    const orcs = event?.pathParameters?.orcs || null;

    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    const placeType = event?.pathParameters?.placeType || event?.queryStringParameters?.placeType || null;
    const identifier = event?.pathParameters?.identifier || event?.queryStringParameters?.identifier || null;

    if (!placeType && identifier) {
      throw new Exception('PlaceType is required when searching by identifier', { code: 400 });
    }

    let places = await getPlaces(orcs, placeType, identifier);

    return sendResponse(200, places, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};