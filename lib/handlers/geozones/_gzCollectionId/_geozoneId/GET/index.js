/**
 * @api {get} /geozone/{gzcollection}/{geozoneid}/ GET
 * Fetch single geozone collection by geozoneId by ORCS
 */

const { getGeozoneByCollectionGeozoneId } = require('/opt/geozones/methods')
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get single Geozone ID', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

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
    
    const res = await getGeozoneByCollectionGeozoneId(gzCollection, gzCollectionId, geozoneId);
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
