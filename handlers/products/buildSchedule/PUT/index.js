/**
 * @api {put} /products/buildSchedule PUT
 * Create a schedule for a product from calendar
 */

const { Exception, logger, sendResponse } = require('/opt/base');
const { buildSchedule } = require('/opt/products/methods');


exports.handler = async (event, context) => {
  logger.info('Build Schedule', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {

    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || null;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || null;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || null;
    const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId || null;
    const startDate = event?.queryStringParameters?.startDate || null;

    if (!orcs || !activityType || !activityId || !productId || !startDate) {
      throw new Exception('ORCS, ActivityType, ActivityId, ProductId and StartDate are all required', { code: 400 });
    }

    // Build the schedule
    let res = await buildSchedule(orcs, activityType, activityId, productId, startDate);

    return sendResponse(200, res, 'Success', null, context);

  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};