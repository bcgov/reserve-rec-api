/**
 * @api {get} /subareas GET
 * Fetch all protected areas
 */

const { getSubareasByOrcs, getSubareaById } = require('/opt/subareas/methods');
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get Protected Areas', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {

    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || null;
    const subareaId = event?.pathParameters?.subareaId || event?.queryStringParameters?.subareaId || null;
    const fetchActivities = Boolean(event?.queryStringParameters?.fetchActivities);
    const fetchFacilities = Boolean(event?.queryStringParameters?.fetchFacilities);

    const fetchObj = {
      fetchActivities: fetchActivities,
      fetchFacilities: fetchFacilities
    }

    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }
    let res = [];
    if (subareaId) {
      res = await getSubareaById(orcs, subareaId, fetchObj);
    } else {
      res = await getSubareasByOrcs(orcs);
    }
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};