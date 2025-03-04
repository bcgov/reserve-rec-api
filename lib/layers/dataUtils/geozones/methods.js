/**
 * Functionality & utils for geozones
 */

const { TABLE_NAME, getOne, runQuery } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');

/**
 * Retrieves a geozone by its geozone collection and id.
 *
 * @param {string[]} gzcollection - The geozone collection of the geozone.
 * @param {string[]} gzid - The geozone id of the geozone collection.
 * @param {Object} params - The parameters for retrieving geozones.
 * @param {number} [params.limit] - The maximum number of geozones to retrieve.
 * @param {string} [params.lastEvaluatedKey] - The key to start retrieving geozones from.
 * @param {boolean} [params.paginated=true] - Indicates whether the results should be paginated.
 * @returns {Promise<any>} - A promise that resolves to the geozone object.
 * @throws {Exception} - If there is an error retrieving the geozone.
 */
async function getGeozonesByCollectionId(gzcollection, gzid, params) {
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    // Get geozone collections
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `geozone::${gzcollection}::${gzid}` }
      },
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Geozone collections: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting geozone collection', { code: 400, error: error });
  }
}

/**
 * Retrieves a geozone by its geozone collection and id.
 *
 * @param {string[]} gzcollection - The geozone collection of the geozone.
 * @param {string[]} gzid - The geozone id of the geozone collection.
 * @param {string[]} said - The geozone id of the geozone collection.
 * @returns {Promise<any>} - A promise that resolves to the geozone object.
 * @throws {Exception} - If there is an error retrieving the geozone.
 */
async function getGeozoneByCollectionSubareaId(gzcollection, gzid, said) {
  try {
    const res = await getOne(`geozone::${gzcollection}::${gzid}`, said);
    return res;
  } catch (error) {
    throw new Exception('Error getting geozone', { code: 400, error: error });
  }
}

module.exports = {
  getGeozonesByCollectionId,
  getGeozoneByCollectionSubareaId
}
