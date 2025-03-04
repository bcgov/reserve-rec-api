/**
 * @api {get} /geozone/{gzcollection}/{gzid}/{said} GET
 * Fetch single geozone collection by subareaId by ORCS
 */

const { getGeozoneByCollectionSubareaId } = require('/opt/geozones/methods')
const { Exception, logger, sendResponse } = require('/opt/base');

exports.handler = async (event, context) => {
  logger.info('Get single Geozone ID', event);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    const gzCollection = event?.pathParameters?.gzcollection;
    const gzCollectionId = event?.pathParameters?.gzcollectionid;
    const gzId = event?.pathParameters?.gzid;

    if (!gzCollection) {
      throw new Exception('Geozone Collection (gzCollection) is required', { code: 400 });
    } else if (!gzCollectionId) {
      throw new Exception('Geozone Collection ID (gzCollectionId) is required', { code: 400 });
    } else if (!gzId) {
      throw new Exception('Geozone ID (gzId) is required', { code: 400 });
    }
    
    const res = await getGeozoneByCollectionSubareaId(gzCollection, gzCollectionId, gzId);
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
