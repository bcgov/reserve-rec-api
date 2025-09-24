const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, deleteItem } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Delete single Protected Area by ORCS', event);
  try {
    const orcs = String(event?.pathParameters?.orcs);
    
    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    const item = { pk: 'protectedArea', sk: orcs }
    const res = await deleteItem(item.pk, item.sk, TABLE_NAME)
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
