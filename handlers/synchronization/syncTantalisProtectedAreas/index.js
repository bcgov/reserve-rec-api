/**
 * Imports geospatial boundary data for protected areas from the Tantalis API
 */

const { getProtectedAreas } = require('/opt/protectedAreas/methods');
const { httpGet, logger, sendResponse } = require('/opt/base');
const { buildIdFromPkSk, bulkWriteDocuments } = require('/opt/opensearch');
const { getCentroidFromEnvelope, getEnvelopeFromMultiPolygon } = require('/opt/geo');
const { TABLE_NAME, batchTransactData, marshall } = require('/opt/dynamodb');

const TANTALIS_ENDPOINT_URL = process.env.TANTALIS_ENDPOINT_URL || 'https://openmaps.gov.bc.ca/geo/pub/WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW/ows';
const TANTALIS_ENDPOINT_PARAMS = '?service=wfs&version=2.0.0&request=getfeature&typename=PUB:WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW&outputFormat=json&srsName=EPSG:4326';
const TANTALIS_CQL_FILTER = '&CQL_FILTER=ORCS_PRIMARY=';

const SYNC_OPENSEARCH = false;
const SYNC_DYNAMODB = true;

exports.handler = async (event, context) => {
  logger.info('Sync Tantalis Protected Areas', event);

  try {

    // Get all protected areas from the reserve-rec database
    const protectedAreas = await getProtectedAreas();

    let updateItemsOS = [];
    let updateItemsDynamo = [];
    let count = 0;
    // Get protected areas from the Tantalis API
    for (let protectedArea of protectedAreas?.items) {
      const paddedOrcs = protectedArea.orcs.padStart(4, '0');
      const url = `${TANTALIS_ENDPOINT_URL}${TANTALIS_ENDPOINT_PARAMS}${TANTALIS_CQL_FILTER}'${paddedOrcs}'`;
      let res;
      try {
        res = await httpGet(url);
      } catch (error) {
        logger.error(`Error getting protected area ${protectedArea.orcs} from Tantalis: ${error}`);
        continue;
      }
      // location = centroid (lat/lng), envelope = bounding box, boundary = polygon boundary
      const { location, envelope, boundary } = formatTantalisData(res.data);
      if (Object.keys(boundary).length > 0) {
        updateItemsOS.push({
          id: buildIdFromPkSk(protectedArea.pk, protectedArea.sk),
          boundary: boundary
        });

        protectedArea.location = location;
        protectedArea.envelope = envelope;

        updateItemsDynamo.push({
          action: 'Put',
          data: {
            TableName: TABLE_NAME,
            Item: marshall(protectedArea)
          }
        });
      }

    }

    if (SYNC_OPENSEARCH) {
      // Update the protected areas in OpenSearch
      logger.info(`Found ${updateItemsOS.length} protected areas with boundaries - updating OpenSearch`);
      await bulkWriteDocuments(updateItemsOS);
      logger.info(`Updated ${updateItemsOS?.length} protected areas with boundaries`);
    }

    if (SYNC_DYNAMODB) {
      // Update the protected areas in DynamoDB
      logger.info(`Found ${updateItemsDynamo.length} protected areas with boundaries - updating DynamoDB`);
      await batchTransactData(updateItemsDynamo);
      logger.info(`Updated ${updateItemsDynamo?.length} protected areas with boundaries`);
    }

    return sendResponse(200, [], 'Success', null, context);
  } catch (error) {
    return sendResponse(400, error);
  }
};

function formatTantalisData(data) {
  // Site data also can be found in the 'features' property - we must filter them out for now
  // It seems like if ORCS_SECONDARY !== '00' then it is a site.
  // Filter out any areas where ORCS_SECONDARY !== '00'.
  // This appears to leave the correct number of protected areas.
  const feature = data?.features?.filter(feature => feature.properties.ORCS_SECONDARY === "00");
  let boundary = {}, envelope = {}, location = {};
  if (feature.length > 0) {
    boundary = feature[0]?.geometry;
    envelope = getEnvelopeFromMultiPolygon(boundary);
    location = getCentroidFromEnvelope(envelope);
  }
  return { location, envelope, boundary };
}