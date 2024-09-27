/**
 * Functionality & utils for protected areas
 */

const { TABLE_NAME, getOne, runQuery } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');

/**
 * Retrieves protected areas based on the provided parameters.
 *
 * @async
 * @param {Object} params - The parameters for retrieving protected areas.
 * @param {number} [params.limit] - The maximum number of protected areas to retrieve.
 * @param {string} [params.lastEvaluatedKey] - The key to start retrieving protected areas from.
 * @param {boolean} [params.paginated=true] - Indicates whether the results should be paginated.
 * @returns {Promise<Object>} The protected areas retrieved.
 * @throws {Exception} If there is an error retrieving protected areas.
 */
async function getProtectedAreas(params) {
  logger.info('Get Protected Areas: params = ', params);
  try {
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    // Get protected areas
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: 'protectedArea' },
      },
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Protected Areas: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting protected areas', { code: 400, error: error });
  }
}

/**
 * Retrieves a protected area by its ORCS.
 *
 * @param {string[]} orcs - The ORCS of the protected area.
 * @returns {Promise<any>} - A promise that resolves to the protected area object.
 * @throws {Exception} - If there is an error retrieving the protected area.
 */
async function getProtectedAreaByOrcs(orcs) {
  try {
    const res = await getOne('protectedArea', orcs);
    return res;
  } catch (error) {
    throw new Exception('Error getting protected area', { code: 400, error: error });
  }
}

module.exports = {
  getProtectedAreaByOrcs,
  getProtectedAreas
}
