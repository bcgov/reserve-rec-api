const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { PROTECTED_AREA_API_PUT_CONFIG } = require("/opt/protectedAreas/configs");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Post single Protected Area ID', event);
  try {
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    const orcs = Number(event?.pathParameters?.orcs);
    
    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    // Set the sk and orcs if they're not provided in the body
    body.sk = String(orcs);
    body.orcs = orcs;

    // Format body with key
    const postItem = {
      key: { pk: `protectedArea`, sk: String(orcs) },
      data: body,
    };

    // Use quickApiUpdateHandler to create the update item
    const postItems = await quickApiPutHandler(TABLE_NAME, [postItem], PROTECTED_AREA_API_PUT_CONFIG);

    // Use batchTransactData to update the database
    const res = await batchTransactData(postItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
