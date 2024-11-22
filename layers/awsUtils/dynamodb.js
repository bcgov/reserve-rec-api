const { BatchGetItemCommand, DynamoDB, DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { logger } = require('/opt/base');

const TABLE_NAME = process.env.TABLE_NAME || 'reserve-rec';
const AUDIT_TABLE_NAME = process.env.UDIT_TABLE_NAME || 'Audit';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const USER_ID_PARTITION = 'userid';
const TRANSACTION_MAX_SIZE = 100;

const options = {
  region: AWS_REGION,
  endpoint: DYNAMODB_ENDPOINT_URL
};

const dynamodb = new DynamoDB(options);

const dynamodbClient = new DynamoDBClient(options);

// simple way to return a single Item by primary key.
async function getOne(pk, sk) {
  logger.info(`getItem: { pk: ${pk}, sk: ${sk} }`);
  const params = {
    TableName: TABLE_NAME,
    Key: marshall({ pk, sk }),
  };
  let item = await dynamodbClient.send(new GetItemCommand(params));
  if (item?.Item) {
    return unmarshall(item.Item);
  }
  return null;
}


async function
  runQuery(query, limit = null, lastEvaluatedKey = null, paginated = true) {
  let data = [];
  let pageData = [];
  let page = 0;

  // If last evaluated key provided, start at the key.
  if (lastEvaluatedKey) {
    pageData['LastEvaluatedKey'] = lastEvaluatedKey;
  }

  do {
    page++;
    if (pageData?.LastEvaluatedKey) {
      query.ExclusiveStartKey = pageData.LastEvaluatedKey;
    }
    // If limit provided, add it to the query params.
    if (limit && paginated) {
      query.Limit = limit;
    }
    pageData = await dynamodbClient.send(new QueryCommand(query));
    data = data.concat(
      pageData.Items.map(item => {
        return unmarshall(item);
      })
    );
    if (page < 2) {
      logger.debug(`Page ${page} data:`, data);
    } else {
      logger.info(`Page ${page} contains ${pageData.Items.length} additional query results...`);
    }
  } while (pageData?.LastEvaluatedKey && !paginated);

  logger.info(`Query result pages: ${page}, total returned items: ${data.length}`);
  if (paginated) {
    return {
      lastEvaluatedKey: pageData.LastEvaluatedKey,
      items: data
    };
  } else {
    return {
      items: data
    };
  }
}

async function runScan(query, limit = null, lastEvaluatedKey = null, paginated = true) {
  let data = [];
  let pageData = [];
  let page = 0;

  // If last evaluated key provided, start at the key.
  if (lastEvaluatedKey) {
    pageData['LastEvaluatedKey'] = lastEvaluatedKey;
  }

  do {
    page++;
    if (pageData?.LastEvaluatedKey) {
      query.ExclusiveStartKey = pageData.LastEvaluatedKey;
    }
    // If limit provided, add it to the query params.
    if (limit && paginated) {
      query.Limit = limit;
    }
    pageData = await dynamodb.scan(query);
    data = data.concat(
      pageData.Items.map(item => {
        return unmarshall(item);
      })
    );
    if (page < 2) {
      logger.debug(`Page ${page} data:`, data);
    } else {
      logger.info(`Page ${page} contains ${pageData.Items.length} additional scan results...`);
    }
  } while (pageData?.LastEvaluatedKey && !paginated);

  logger.info(`Scan result pages: ${page}, total returned items: ${data.length}`);
  if (paginated) {
    return {
      lastEvaluatedKey: pageData.LastEvaluatedKey,
      items: data
    };
  } else {
    return {
      items: data
    };
  }
}

async function putItem(obj, tableName = TABLE_NAME) {
  let putObj = {
    TableName: tableName,
    Item: obj,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
  };

  await dynamodb.putItem(putObj);
}

async function parallelizedBatchGetData(groups, tableName) {
  // create array from groups
  const keys = Object.keys(groups);
  const promises = await Promise.all(keys.map(key => batchGetDataPromise(key, groups[key], tableName)));
  return promises;
}

function batchGetDataPromise(groupName, keys, tableName) {
  let data = [];
  return new Promise((resolve, reject) => {
    const params = {
      RequestItems: {
        [tableName]: {
          Keys: keys.map(key => marshall(key))
        }
      }
    };
    const command = new BatchGetItemCommand(params);
    dynamodbClient.send(command, (err, res) => {
      if (err) {
        reject(err);
      } else {
        data = res.Responses[tableName].map(item => unmarshall(item));
        if (res.UnprocessedKeys[tableName]?.Keys) {
          data['unprocessedKeys'] = res.UnprocessedKeys[tableName]?.Keys;
        }
        resolve({
          key: groupName,
          data: data
        });
      }
    });
  });
}


async function batchWriteData(dataToInsert, chunkSize, tableName) {
  logger.debug(JSON.stringify(dataToInsert));

  const dataChunks = chunkArray(dataToInsert, chunkSize);

  logger.debug(JSON.stringify(dataChunks));

  for (let index = 0; index < dataChunks.length; index++) {
    const chunk = dataChunks[index];

    const writeRequests = chunk.map(item => ({
      PutRequest: {
        Item: item
      }
    }));

    logger.debug(JSON.stringify(writeRequests));

    const params = {
      RequestItems: {
        [tableName]: writeRequests
      }
    };

    try {
      logger.info(JSON.stringify(params));
      const data = await dynamodb.batchWriteItem(params);
      logger.info(`BatchWriteItem response for chunk ${index}:`, data);
    } catch (err) {
      logger.info(`Error batch writing items in chunk ${index}:`, err);
    }
  }
}

// Assume data is already in Dynamo Json format
// Function to chunk the data into smaller arrays
function chunkArray(array, chunkSize) {
  const result = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }
  return result;
}

/**
 * Asynchronously batches and transacts data into DynamoDB.
 * @async
 * @param {Array<Object>} data - The array of objects to be transacted into DynamoDB.
 * If you want the transaction action to differ from the one provided in the `action` argument,
 * you can provide your data as {action: ('Put', 'Update', 'Delete', 'ConditionExpression'), data: <object> }.
 * This allows you to perform more than 1 type of action per transaction.
 * @param {string} [action='Put'] - The default action to perform if not specified for each item ('Put', 'Update', 'Delete', 'ConditionExpression').
 * @returns {Promise<boolean>} - A Promise that resolves to true if the batch transact operation succeeds.
 */
async function batchTransactData(data, action = 'Put') {

  const dataChunks = chunkArray(data, TRANSACTION_MAX_SIZE);

  logger.info('Data items:', data.length);
  logger.info('Transactions:', dataChunks.length);

  try {
    for (let index = 0; index < dataChunks.length; index++) {
      const chunk = dataChunks[index];

      const TransactItems = chunk.map(item => {
        let op = item?.action || action;
        switch (op) {
          case 'ConditionExpression':
            return { ConditionExpression: item?.data || item };
          case 'Update':
            return { Update: item?.data || item };
          case 'Delete':
            return { Delete: item?.data || item };
          case 'Put':
          default:
            return { Put: item?.data || item };
        }
      });

      logger.debug(JSON.stringify(TransactItems, null, 2));

      const data = await dynamodbClient.send(
        new TransactWriteItemsCommand({ TransactItems: TransactItems })
      );
      if (data.$metadata.httpStatusCode !== 200) {
        throw new Error(`BatchTransactItems failed with status code: ${data.$metadata.httpStatusCode}`);
      }
      logger.info(`BatchWriteItem response for chunk ${index}:`, data);
    }
  } catch (error) {
    logger.error(`Error batch writing items:`, error);
    throw error;
  }
  return true;
}

module.exports = {
  AUDIT_TABLE_NAME,
  AWS_REGION,
  PutItemCommand,
  QueryCommand,
  TABLE_NAME,
  USER_ID_PARTITION,
  batchTransactData,
  batchWriteData,
  dynamodb,
  dynamodbClient,
  getOne,
  marshall,
  parallelizedBatchGetData,
  putItem,
  runQuery,
  runScan,
  unmarshall,
};