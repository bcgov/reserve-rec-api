const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { GEOZONE_API_PUT_CONFIG } = require("/opt/geozones/configs");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Put batch Geozone IDs', event);
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
    let putRequests = [];
    for (const item of body) {
      
      if (!item?.identifier) {
        throw new Exception('Identifier is required for every post item', { code: 400 });
      }
      
      const pk = `geozone::${gzCollection}::${gzCollectionId}`;
      const sk = String(item.identifier);

      item.pk = pk
      item.sk = sk

      const putItem = {
        key: { pk: pk, sk: sk },
        data: item,
      };

      putRequests.push(putItem);
    }

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(TABLE_NAME, putRequests, GEOZONE_API_PUT_CONFIG);

    // Use batchTransactData to put the database
    const res = await batchTransactData(putItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
