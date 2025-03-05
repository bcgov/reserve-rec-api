const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { GEOZONE_API_UPDATE_CONFIG } = require("/opt/geozones/configs");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Update single Geozone ID', event);
  try {
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }
    
    const gzCollection = event?.pathParameters?.gzcollection;
    const gzCollectionId = String(event?.pathParameters?.gzcollectionid);
    const geozoneId = event?.pathParameters?.geozoneid;

    if (!gzCollection) {
      throw new Exception('Geozone Collection (gzCollection) is required', { code: 400 });
    } else if (!gzCollectionId) {
      throw new Exception('Geozone Collection ID (gzCollectionId) is required', { code: 400 });
    } else if (!geozoneId) {
      throw new Exception('Geozone ID (geozoneId) is required', { code: 400 });
    }

    // Format body with key
    const updateItem = {
      key: { pk: `geozone::${gzCollection}::${gzCollectionId}`, sk: geozoneId },
      data: body,
    };

    // Use quickApiUpdateHandler to create the update item
    const updateItems = await quickApiUpdateHandler(TABLE_NAME, [updateItem], GEOZONE_API_UPDATE_CONFIG);

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
