/**
 * Update subareas
 */

const { Exception, logger, sendResponse } = require("/opt/base");
const { putSubarea } = require("/opt/subareas/methods");

exports.handler = async (event, context) => {
  logger.info('PUT subarea', event);
  try {
    const body = JSON.parse(event?.body);
    const orcs = event?.pathParameters?.orcs || event?.queryStringParameters?.orcs || body?.orcs;
    const subareaId = event?.pathParameters?.subareaId || event?.queryStringParameters?.subareaId || body?.subareaId;

    if (!body || !orcs || !subareaId) {
      throw new Exception('Invalid request body', {
        code: 400,
      });
    }

    const res = await putSubarea(orcs, subareaId, body);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};