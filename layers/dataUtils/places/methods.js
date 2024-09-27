const { TABLE_NAME, runQuery } = require('/opt/dynamodb');

/**
 * Retrieves places from the database based on the provided ORCS, place type, and identifier.
 *
 * @param {string} orcs - The ORCS identifier.
 * @param {string} [placeType=null] - The type of place to filter by (optional).
 * @param {string} [identifier=null] - The specific identifier for the place type (optional).
 * @returns {Promise<Object>} A promise that resolves to the query result.
 */
async function getPlaces(orcs, placeType = null, identifier = null, params = null) {
  // build query
  let queryCommand = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `place::${orcs}` }
    }
  };
  if (placeType) {
    if (identifier) {
      queryCommand.KeyConditionExpression += ' AND sk = :sk';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: `${placeType}::${identifier}` };
    } else {
      queryCommand.KeyConditionExpression += ' AND begins_with(sk, :sk)';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: placeType };
    }
  }

  return await runQuery(queryCommand, params?.limit || null, params?.lastEvaluatedKey || null, params?.paginated || false);
}

module.exports = {
  getPlaces
};