/**
 * @api {get} /activities GET
 * Fetch all activities
 */

const { getActivitiesByOrcs, getActivityById } = require('/opt/activities/methods');
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get Activity', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {

    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || null;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || null;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || null;
    const fetchProducts = Boolean(event?.queryStringParameters?.fetchProducts);

    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    // need both activityType and activityId to fetch specific activity
    // otherwise we can fetch by orcs - in which case we need neither activityType nor activityId
    // aka XOR gate
    if ((!activityType ^ !activityId)) {
      throw new Exception('ActivityType and ActivityId are required', { code: 400 });
    }

    const fetchObj = {
      fetchProducts: fetchProducts
    };

    let activitySk = (activityType && activityId) ? `${activityType}::${activityId}` : null;

    let res = [];
    if (activitySk) {
      res = await getActivityById(orcs, activityType, activityId, fetchObj);
    } else {
      res = await getActivitiesByOrcs(orcs);
    }
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};