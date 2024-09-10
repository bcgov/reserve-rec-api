const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { PROTECTED_AREA_API_UPDATE_CONFIG } = require("/opt/data-constants");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Put single Protected Areas', event);
  try {
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }
    const orcs = event?.pathParameters?.orcs;
    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    // Format body with key
    body['key'] = { pk: 'protectedArea', sk: orcs };

    // Use quickApiUpdateHandler to create the update item
    const updateItem = await quickApiUpdateHandler(TABLE_NAME, [body], PROTECTED_AREA_API_UPDATE_CONFIG);

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItem);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};