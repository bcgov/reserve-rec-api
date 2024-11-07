const { TABLE_NAME, getOne, runQuery } = require('/opt/dynamodb');
const { Exception } = require('/opt/base');

/**
 * Retrieves permits from the database based on the provided parameters.
 *
 * @param {string} orcs - The ORCS identifier for the permit.
 * @param {string} [permitType=null] - The type of permit to filter by.
 * @param {string} [identifier=null] - The specific identifier for the permit.
 * @param {Object} [params=null] - Additional query parameters.
 * @param {number} [params.limit=null] - The maximum number of items to return.
 * @param {Object} [params.lastEvaluatedKey=null] - The key to start the query from.
 * @param {boolean} [params.paginated=false] - Whether to paginate the results.
 * @returns {Promise<Object>} The result of the query.
 */
async function getPermits(orcs, permitType = null, identifier = null, params = null) {
  // build query
  let queryCommand = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `permit::${orcs}` }
    }
  };
  if (permitType) {
    if (identifier) {
      queryCommand.KeyConditionExpression += ' AND sk = :sk';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: `${permitType}::${identifier}::properties` };
    } else {
      queryCommand.KeyConditionExpression += ' AND begins_with(sk, :sk)';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: permitType };
    }
  }

  return await runQuery(queryCommand, params?.limit || null, params?.lastEvaluatedKey || null, params?.paginated || false);
}

async function getPermit(orcs, permitType, identifier, startDate = null, endDate = null) {
  const permitProps = await getOne(`permit::${orcs}`, `${permitType}::${identifier}::properties`);
  if (!permitProps) {
    throw new Exception(`No static properties found for pk: permit::${orcs}, sk: ${permitType}::${identifier}::properties`, { code: 404 });
  }
  console.log('permitProps:', permitProps);
  let permitData = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `permit::${orcs}` }
    }
  };

  if (startDate) {
    permitData.ExpressionAttributeValues[':startDate'] = { S: `${permitType}::${identifier}::${startDate}` };
    if (endDate) {
      // Get a range of permits between the start and end date
      permitData.KeyConditionExpression += ' AND sk BETWEEN :startDate AND :endDate';
      permitData.ExpressionAttributeValues[':endDate'] = { S: `${permitType}::${identifier}::${endDate}` };
    } else {
      // No end date provided; get a single permit with the start date
      permitData.KeyConditionExpression += ' AND sk = :startDate';
    }
  }

  console.log('permitData:', permitData);

  let temporalPermitData = await runQuery(permitData, null, null, false);

  // Merge the static and temporal permit data
  return { ...permitProps, dates: temporalPermitData.items };
}

module.exports = {
  getPermits,
  getPermit
};