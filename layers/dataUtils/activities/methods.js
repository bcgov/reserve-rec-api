const { TABLE_NAME, runQuery, getOne } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');
const { getProductsByActivity } = require('/opt/products/methods');

async function getActivitiesByOrcs(orcs, params = null) {
  logger.info('Get Activities');
  try {
    if (!orcs) {
      throw 'ORCS is required';
    }
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `activity::${orcs}` }
      }
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Activities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting activities', { code: 400, error: error });
  }
}

async function getActivityById(orcs, type, id, fetchObj = null) {
  logger.info('Get Activity By Type and ID');
  try {
    let res = await getOne(`activity::${orcs}`, `${type}::${id}`);
    if (fetchObj?.fetchProducts) {
      const products = await getProductsByActivity(orcs, type, id);
      res.products = products?.items || [];
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting activity', { code: 400, error: error });
  }
}

module.exports = {
  getActivitiesByOrcs,
  getActivityById
};