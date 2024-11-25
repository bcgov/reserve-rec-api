/**
 * @api {get} /products GET
 * Fetch all prudcts
 */

const { getProductsByActivity, getProductById } = require('/opt/products/methods');
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get Products', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {

    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || null;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || null;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || null;
    const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId || null;
    const fetchPolicies = Boolean(event?.queryStringParameters?.fetchPolicies);

    if (!orcs || !activityType || !activityId) {
      throw new Exception('ORCS, ActivityType and ActivityId are all required', { code: 400 });
    }

    const fetchObj = {
      fetchPolicies: fetchPolicies,
    };

    let res = [];
    if (productId) {
      res = await getProductById(orcs, activityType, activityId, productId, fetchObj);
    } else {
      res = await getProductsByActivity(orcs, activityType, activityId);
    }
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};