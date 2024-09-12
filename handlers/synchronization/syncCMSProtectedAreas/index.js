/**
 * Imports protected area data from CMS.
 */

const { httpGet, logger, sendResponse } = require('/opt/base');
const { getProtectedAreas } = require('/opt/protectedAreas');
const { quickApiUpdateHandler } = require('/opt/data-utils');
const { TABLE_NAME, batchTransactData } = require('/opt/dynamodb');

const CMS_ENDPOINT_URL = process.env.CMS_ENDPOINT_URL || 'https://cms.bcparks.ca/api';
const CMS_ENDPOINT_SUBDIRECTORY = '/protected-areas';
const PARAMS = '?populate=*&pagination[limit]=-1';

const CONFIG = {
  actionRules: {
    set: {
      whitelist: ['location']
    }
  },
  autoTimestamp: true,
  autoVersion: true,
  failOnError: false
};

exports.handler = async (event, context) => {
  logger.info('Sync CMS Protected Areas', event);
  try {
    // Get all protected areas from the reserve-rec database
    const protectedAreas = await getProtectedAreas();

    let updateItems = [];

    // Get protected areas from the CMS
    for (const protectedArea of protectedAreas?.items) {
      const url = `${CMS_ENDPOINT_URL}${CMS_ENDPOINT_SUBDIRECTORY}/${protectedArea.orcs}${PARAMS}`;
      let res;
      try {
        res = await httpGet(url);
      } catch (error) {
        logger.error(`Error getting protected area ${protectedArea.orcs} from CMS: ${error}`);
        continue;
      }

      if (res?.data) {
        // Update the protected area in the database
        const fieldsToSync = getFieldsToSync(res.data);
        const updateItem = {
          key: {
            pk: 'protectedArea',
            sk: protectedArea.orcs
          },
          set: fieldsToSync
        };
        updateItems.push(updateItem);
      }
    }

    const res = await quickApiUpdateHandler(TABLE_NAME, updateItems, CONFIG);

    await batchTransactData(res);

    return sendResponse(200, [], 'Success', null, context);
  } catch (error) {
    return sendResponse(400, error);
  }
};

function getFieldsToSync(data) {
  // Build geospatial data
  if (!data?.latitude || !data?.longitude) {
    return {};
  }
  const location = {
    type: 'Point',
    coordinates: [data?.longitude, data?.latitude]
  };

  const fieldsToSync = {
    location: location,
  };

  return fieldsToSync;
}