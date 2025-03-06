const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { PROTECTED_AREA_API_PUT_CONFIG } = require("/opt/protectedAreas/configs");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Put batch Protected Areas', event);
  try {
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    if (!Array.isArray(body)) {
      throw new Exception('Body must be an array', { code: 400 });
    }

    // extract ORCS and actions from body
    let putRequests = [];
    for (const item of body) {

      if (!item?.orcs) {
        throw new Exception('ORCS is required for each item', { code: 400 });
      }
      
      const sk = String(item?.orcs);

      item.pk = 'protectedArea';
      item.sk = sk;
      item.orcs = item?.orcs;

      const putItem = {
        key: { pk: 'protectedArea', sk: sk },
        data: item,
      };

      putRequests.push(putItem);
    }

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(TABLE_NAME, putRequests, PROTECTED_AREA_API_PUT_CONFIG);

    // Use batchTransactData to put the database
    const res = await batchTransactData(putItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
