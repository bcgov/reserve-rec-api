/**
 * @api {get} /facilities GET
 * Fetch all facilities
 */

const { getFacilitiesByOrcs, getFacilityById } = require('/opt/facilities/methods');
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get Facility', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {

    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || null;
    const facilityType = event?.pathParameters?.facilityType || event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.pathParameters?.facilityId || event?.queryStringParameters?.facilityId || null;
    const fetchActivities = Boolean(event?.queryStringParameters?.fetchActivities);

    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    // need both facilityType and facilityId to fetch specific facility
    // otherwise we can fetch by orcs - in which case we need neither facilityType nor facilityId
    // aka XOR gate
    if ((!facilityType ^ !facilityId)) {
      throw new Exception('FacilityType and FacilityId are required', { code: 400 });
    }

    const fetchObj = {
      fetchActivities: fetchActivities,
    };

    let facilitySk = (facilityType && facilityId) ? `${facilityType}::${facilityId}` : null;

    let res = [];
    if (facilitySk) {
      res = await getFacilityById(orcs, facilityType, facilityId, fetchObj);
    } else {
      res = await getFacilitiesByOrcs(orcs);
    }
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};