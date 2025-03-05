const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { GEOZONE_API_PUT_CONFIG } = require("/opt/geozones/configs");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Post single Geozone ID', event);
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

    // Set the pk, sk, gzCollectionId, and orcs if they're not provided in the body
    body.pk = `geozone::${gzCollection}::${gzCollectionId}`;
    body.sk = String(geozoneId);

    // Format body with key
    const postItem = {
      key: { pk: `geozone::${gzCollection}::${gzCollectionId}`, sk: geozoneId },
      data: body,
    };

    // Use quickApiUpdateHandler to create the update item
    const postItems = await quickApiPutHandler(TABLE_NAME, [postItem], GEOZONE_API_PUT_CONFIG);

    // Use batchTransactData to update the database
    const res = await batchTransactData(postItems);

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
