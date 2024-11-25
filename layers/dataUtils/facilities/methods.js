const { TABLE_NAME, runQuery, getOne } = require('/opt/dynamodb');
const { Exception, logger } = require('/opt/base');
const { getActivitiesByOrcs } = require('/opt/activities/methods');

async function getFacilitiesByOrcs(orcs, params = null) {
  logger.info('Get Facilities');
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
        ':pk': { S: `facility::${orcs}` }
      }
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Facilities: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting facilities', { code: 400, error: error });
  }
}

async function getFacilityById(orcs, type, id, fetchObj = null) {
  logger.info('Get Facility By Type and ID');
  try {
    let res = await getOne(`facility::${orcs}`, `${type}::${id}`);
    if (fetchObj?.fetchActivities) {
      const activities = await getActivitiesByOrcs(orcs);
      res.activities = activities?.items || [];
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting facility', { code: 400, error: error });
  }
}

module.exports = {
  getFacilitiesByOrcs,
  getFacilityById
};