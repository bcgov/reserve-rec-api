const { TABLE_NAME, runQuery } = require('/opt/dynamodb');

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
      queryCommand.ExpressionAttributeValues[':sk'] = { S: `${permitType}::${identifier}` };
    } else {
      queryCommand.KeyConditionExpression += ' AND begins_with(sk, :sk)';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: permitType };
    }
  }

  return await runQuery(queryCommand, params?.limit || null, params?.lastEvaluatedKey || null, params?.paginated || false);
}

module.exports = {
  getPermits
};