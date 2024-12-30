/**
 * Create subareas
 */

const { Exception, logger, sendResponse } = require("/opt/base");
const { postSubarea } = require("/opt/subareas/methods");

exports.handler = async (event, context) => {
  logger.info('POST subarea', event);
  try {
    const body = JSON.parse(event?.body);
    const orcs = event?.pathParameters?.orcs || body?.orcs;

    if (!body || !orcs) {
      throw new Exception('Invalid request body', {
        code: 400,
      });
    }

    const res = await postSubarea(orcs, body);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};