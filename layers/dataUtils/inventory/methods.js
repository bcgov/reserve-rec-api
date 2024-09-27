const { TABLE_NAME, runQuery } = require('/opt/dynamodb');

async function getInventory(orcs, placeType, placeId, inventoryType = null, identifier = null, params = null) {
  // build query
  let queryCommand = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `inventory::${orcs}::${placeType}::${placeId}` }
    }
  };
  if (inventoryType) {
    if (identifier) {
      queryCommand.KeyConditionExpression += ' AND sk = :sk';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: `${inventoryType}::${identifier}` };
    } else {
      queryCommand.KeyConditionExpression += ' AND begins_with(sk, :sk)';
      queryCommand.ExpressionAttributeValues[':sk'] = { S: inventoryType };
    }
  }

  return await runQuery(queryCommand, params?.limit || null, params?.lastEvaluatedKey || null, params?.paginated || false);
}

module.exports = {
  getInventory
};