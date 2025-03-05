const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { GEOZONE_API_UPDATE_CONFIG } = require("/opt/geozones/configs");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Update batch Geozone IDs', event);
  try {
    const gzCollection = event?.pathParameters?.gzcollection;
    const gzCollectionId = String(event?.pathParameters?.gzcollectionid);
    
    if (!gzCollection) {
      throw new Exception('Geozone Collection (gzCollection) is required', { code: 400 });
    } else if (!gzCollectionId) {
      throw new Exception('Geozone Collection ID (gzCollectionId) is required', { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    if (!Array.isArray(body)) {
      throw new Exception('Body must be an array', { code: 400 });
    }

    // extract Geozone ID and actions from body
    let updateRequests = [];
    for (const item of body) {

      if (!item?.identifier) {
        throw new Exception('identifier is required for every put item', { code: 400 });
      }
      
      const pk = `geozone::${gzCollection}::${gzCollectionId}`;
      const sk = String(item.identifier);

      const updateItem = {
        key: { pk: pk, sk: sk },
        data: item,
      };

      updateRequests.push(updateItem);
    }

    // Use quickApiUpdateHandler to create the update items
    const updateItems = await quickApiUpdateHandler(TABLE_NAME, updateRequests, GEOZONE_API_UPDATE_CONFIG);

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
