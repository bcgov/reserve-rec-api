/**
 * @api {get} /geozone/{gzcollection}/{gzcollectionid} GET
 * Fetch single geozone by ORCS
 */

const { getGeozonesByCollectionId } = require('/opt/geozones/methods')
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get single Geozone collection', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    const gzCollection = event?.pathParameters?.gzcollection;
    const gzCollectionId = String(event?.pathParameters?.gzcollectionid);

    if (!gzCollection) {
      throw new Exception('gzCollection is required', { code: 400 });
    }
    if (!gzCollectionId) {
      throw new Exception('gzCollectionId is required', { code: 400 });
    }

    const res = await getGeozonesByCollectionId(gzCollection, gzCollectionId, event?.queryStringParameters || null);
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
