const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { PROTECTED_AREA_API_UPDATE_CONFIG } = require("/opt/protectedAreas/configs");
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

    // extract orcs and actions from body
    let updateRequests = [];
    for (const item of body) {
      if (!item?.orcs) {
        throw new Exception('ORCS number is required for every update item', { code: 400 });
      }

      const sk = String(item.orcs);
      delete item.orcs;

      const updateItem = {
        key: { pk: 'place::protectedArea', sk: sk },
        data: item,
      };

      updateRequests.push(updateItem);
    }

    // Use quickApiUpdateHandler to create the update items
    const updateItems = await quickApiUpdateHandler(TABLE_NAME, updateRequests, PROTECTED_AREA_API_UPDATE_CONFIG);

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};