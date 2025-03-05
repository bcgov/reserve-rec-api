const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, deleteItem } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Delete single Geozone ID', event);
  try {
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

    const item = { pk: `geozone::${gzCollection}::${gzCollectionId}`, sk: geozoneId }
    const res = await deleteItem(item.pk, item.sk, TABLE_NAME)
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
