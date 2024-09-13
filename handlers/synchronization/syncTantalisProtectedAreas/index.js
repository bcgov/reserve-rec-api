/**
 * Imports geospatial boundary data for protected areas from the Tantalis API
 */

const { getProtectedAreas } = require('/opt/protectedAreas');
const { httpGet, logger, sendResponse } = require('/opt/base');
const { buildIdFromPkSk, bulkUpdateDocuments} = require('/opt/opensearch');

const TANTALIS_ENDPOINT_URL = process.env.TANTALIS_ENDPOINT_URL || 'https://openmaps.gov.bc.ca/geo/pub/WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW/ows';
const TANTALIS_ENDPOINT_PARAMS = '?service=wfs&version=2.0.0&request=getfeature&typename=PUB:WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW&outputFormat=json&srsName=EPSG:4326';
const TANTALIS_CQL_FILTER = '&CQL_FILTER=ORCS_PRIMARY=';

exports.handler = async (event, context) => {
  logger.info('Sync Tantalis Protected Areas', event);

  try {

    // Get all protected areas from the reserve-rec database
    const protectedAreas = await getProtectedAreas();

    let updateItems = [];
    let count = 0;
    // Get protected areas from the Tantalis API
    for (const protectedArea of protectedAreas?.items) {
      const paddedOrcs = protectedArea.orcs.padStart(4, '0');
      const url = `${TANTALIS_ENDPOINT_URL}${TANTALIS_ENDPOINT_PARAMS}${TANTALIS_CQL_FILTER}'${paddedOrcs}'`;
      let res;
      try {
        res = await httpGet(url);
      } catch (error) {
        logger.error(`Error getting protected area ${protectedArea.orcs} from Tantalis: ${error}`);
        continue;
      }
      const boundary = formatTantalisData(res.data, protectedArea);
      if (Object.keys(boundary).length > 0) {
        updateItems.push({
          id: buildIdFromPkSk(protectedArea.pk, protectedArea.sk),
          body: {
            boundary: boundary
          }
        });
      }

    }

    logger.info(`Found ${updateItems.length} protected areas with boundaries - updating OpenSearch`);

    // Update the protected areas in OpenSearch
    await bulkUpdateDocuments(updateItems);

    logger.info(`Updated ${count} protected areas with boundaries`);

    return sendResponse(200, [], 'Success', null, context);
  } catch (error) {
    return sendResponse(400, error);
  }
};

function formatTantalisData(data, protectedArea) {
  // Site data also can be found in the 'features' property - we must filter them out for now
  // It seems like if ORCS_SECONDARY !== '00' then it is a site.
  // Filter out any areas where ORCS_SECONDARY !== '00'.
  // This appears to leave the correct number of protected areas.
  const feature = data?.features?.filter(feature => feature.properties.ORCS_SECONDARY === "00");
  let boundary = {};
  if (feature.length > 0) {
    boundary = feature[0]?.geometry;
  }
  return boundary;
}