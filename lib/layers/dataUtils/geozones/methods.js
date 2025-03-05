/**
 * Functionality & utils for geozones
 */

const { TABLE_NAME, getOne, runQuery } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');

/**
 * Retrieves a geozone by its geozone collection and id.
 *
 * @param {string[]} gzCollection - The geozone collection of the geozone.
 * @param {string[]} geozoneId - The geozone id of the geozone collection.
 * @param {Object} params - The parameters for retrieving geozones.
 * @param {number} [params.limit] - The maximum number of geozones to retrieve.
 * @param {string} [params.lastEvaluatedKey] - The key to start retrieving geozones from.
 * @param {boolean} [params.paginated=true] - Indicates whether the results should be paginated.
 * @returns {Promise<any>} - A promise that resolves to the geozone object.
 * @throws {Exception} - If there is an error retrieving the geozone.
 */
async function getGeozonesByCollectionId(gzCollection, geozoneId, params) {
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    // Get geozone collections
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `geozone::${gzCollection}::${geozoneId}` }
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
 * Retrieves a geozone by its geozone collection and geozoneId.
 *
 * @param {string[]} gzCollection - The geozone collection of the geozone.
 * @param {string[]} gzCollectionId - The geozone collection ID of the geozone collection.
 * @param {string[]} geozoneId - The geozoneId within the geozone collection.
 * @returns {Promise<any>} - A promise that resolves to the geozone object.
 * @throws {Exception} - If there is an error retrieving the geozone.
 */
async function getGeozoneByCollectionGeozoneId(gzCollection, gzCollectionId, geozoneId) {
  try {
    const res = await getOne(`geozone::${gzCollection}::${gzCollectionId}`, geozoneId);
    return res;
  } catch (error) {
    throw new Exception('Error getting geozone', { code: 400, error: error });
  }
}

module.exports = {
  getGeozonesByCollectionId,
  getGeozoneByCollectionGeozoneId
}
