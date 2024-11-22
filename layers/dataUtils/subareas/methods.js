/**
 * Functionality and utils for subareas
 */

const { TABLE_NAME, getOne, parallelizedBatchGetData, runQuery } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');

async function getSubareasByOrcs(orcs, params = null) {
  logger.info('Get PA Subareas');
  try {
    if (!orcs) {
      throw 'ORCS is required';
    }
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    // Get subareas
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `subarea::${orcs}` },
      },
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Subareas: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting subareas', { code: 400, error: error });
  }
}

async function getSubareaById(orcs, id, fetchObj = null) {
  logger.info('Get Subarea By ID');
  try {
    let res = await getOne(`subarea::${orcs}`, id);
    // In the case where we want to fetch activities and/or facilites, there is no capacity unit cost saving by batching the gets, only a latency cost saving - so we can just do them in parallel to keep their results separate.
    let promiseObj = {};
    if (fetchObj?.fetchActivities && res.activities) {
      let activities = [];
      for (const activity of res?.activities) {
        activities.push({ pk: `activity::${orcs}`, sk: activity });
      }
      promiseObj.activities = activities;
    }
    if (fetchObj?.fetchFacilities && res?.facilities) {
      let facilities = [];
      for (const facility of res.facilities) {
        facilities.push({ pk: `facility::${orcs}`, sk: facility });
      }
      promiseObj.facilities = facilities;
    }

    if (Object.keys(promiseObj).length) {
      let results = await parallelizedBatchGetData(promiseObj, TABLE_NAME);
      // Merge the results back into the subarea object
      for (const result of results) {
        res[result.key] = result.data;
      }
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting subarea', { code: 400, error: error });
  }
}

module.exports = {
  getSubareasByOrcs,
  getSubareaById,
};