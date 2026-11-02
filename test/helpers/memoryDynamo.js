// In-memory stand-in for DynamoDBClient.send covering GetItem, PutItem and BatchWriteItem.
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

function memoryDynamo() {
  const tables = {};
  const rows = (table) => (tables[table] ||= new Map());
  const keyOf = (item) => `${item.pk.S}|${item.sk?.S}`;

  async function send(command) {
    const { input } = command;
    switch (command.constructor.name) {
      case 'GetItemCommand': {
        const item = rows(input.TableName).get(keyOf(input.Key));
        return item ? { Item: item } : {};
      }
      case 'PutItemCommand':
        rows(input.TableName).set(keyOf(input.Item), input.Item);
        return {};
      case 'BatchWriteItemCommand':
        for (const [table, requests] of Object.entries(input.RequestItems)) {
          for (const { PutRequest } of requests) rows(table).set(keyOf(PutRequest.Item), PutRequest.Item);
        }
        return {};
      default:
        throw new Error(`memoryDynamo: unsupported ${command.constructor.name}`);
    }
  }

  return {
    send,
    put: (table, item) => rows(table).set(keyOf(marshall(item)), marshall(item)),
    get: (table, pk, sk) => {
      const item = rows(table).get(`${pk}|${sk}`);
      return item ? unmarshall(item) : undefined;
    },
    all: (table) => [...rows(table).values()].map((i) => unmarshall(i)),
  };
}

module.exports = { memoryDynamo };
