
const { TABLE_NAME, runQuery } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');

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

module.exports = {
  getProductsByActivity
}