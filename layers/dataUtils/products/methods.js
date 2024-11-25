
const { TABLE_NAME, runQuery, getOne, parallelizedBatchGetData } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');
const { POLICY_TYPES } = require('/opt/policies/configs');

async function getProductsByActivity(orcs, activityType, activityId) {
  logger.info('Get Products By Activity', orcs, activityType, activityId);
  try {
    if (!orcs || !activityType || !activityId) {
      throw 'ORCS, ActivityType and ActivityId are required';
    }
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `product::${orcs}::${activityType}::${activityId}` },
      },
    };
    const res = await runQuery(queryObj);
    logger.info(`Products: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting products', { code: 400, error: error });
  }
}

async function getProductById(orcs, activityType, activityId, productId, fetchObj = null) {
  logger.info('Get Product By Id');
  try {
    let res = await getOne(`product::${orcs}::${activityType}::${activityId}`, `${productId}::properties`);
    let promiseObj = {};
    if (fetchObj?.fetchPolicies) {
      console.log('POLICY_TYPES:', POLICY_TYPES);
      POLICY_TYPES.map(policyType => {
        const property = `${policyType}Policy`;
        promiseObj[property] = [{
          pk: `policy::${policyType}`,
          sk: `${res[property]}`,
        }];
      });
    }
    console.log('promiseObj:', promiseObj);
    if (Object.keys(promiseObj).length) {
      let results = await parallelizedBatchGetData(promiseObj, TABLE_NAME);
      console.log('results:', results);
      for (const result of results) {
        res[result.key] = result.data;
      }
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting product', { code: 400, error: error });
  }
}

module.exports = {
  getProductsByActivity,
  getProductById,
};