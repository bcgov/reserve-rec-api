const { BatchGetItemCommand, DynamoDB, DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, DeleteItemCommand, UpdateItemCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { logger } = require('/opt/base');

const TABLE_NAME = process.env.TABLE_NAME || 'reserve-rec';
const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE_NAME || 'Audit';
const PUBSUB_TABLE_NAME = process.env.PUBSUB_TABLE_NAME || 'reserve-rec-pubsub';
const COUNTER_TABLE_NAME = process.env.COUNTER_TABLE_NAME || 'reserve-rec-counter'
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const USER_ID_PARTITION = 'userid';
const TRANSACTION_MAX_SIZE = 100;

const options = {
  region: AWS_REGION,
};

if (process.env?.IS_OFFLINE === 'true') {
  options.endpoint = DYNAMODB_ENDPOINT_URL;
}

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

/**
 * Increments/creates a counter value in DynamoDB; calls resetCounter if it
 * doesn't exist.
 * @param {string} pk - The schema identifier (e.g. "geozone::bcparks_7")
 * @param {Array} collectionType - An optional array of collection types for
 *                                 the counter item (e.g. "structure", "dayuse")
 * 
 * @returns {integer} The next logical ID for the counter value.
 */
async function incrementCounter(pk, collectionType = []) {
  logger.debug(`Incrementing pk: ${pk}`);
  logger.debug(`CollectionType ${collectionType}`);

  // Allow user to pass in an array of collectionTypes. These are used to
  // further identify the item, such as "structure" or "dayuse", and would
  // be used as part of the sk of the item.
  let skType = '';
  if (collectionType?.length > 0) {
    skType = collectionType.join('::')
  }

  try {
    // Get current counter value. Built using pk and partial sk.
    const getCounterParams = {
      TableName: COUNTER_TABLE_NAME,
      Key: {
        pk: { S: `counter::${pk}${skType ? "::" + skType : ""}` },
      },
    };

    const getRes = await dynamodb.send(new GetItemCommand(getCounterParams));

    // If we don't return an Item, it means there's no counter to begin with
    // but we can set to 0 and use that to flag a probable reason to reset.
    const rawItem = getRes?.Item;
    let item;
    if (rawItem) {
      item = unmarshall(rawItem);
    } else {
      item = { counterValue: 0 };
      logger.debug("No counter found — defaulting to 0");
    }

    const countCurrent = item?.counterValue;
    logger.debug(`Counter's current value is: ${countCurrent}`);

    // Check what this item's actual count on the main table is, or if this
    // item even exists.
    const countParams = {
      TableName: TABLE_NAME,
      KeyConditionExpression: skType
        ? "pk = :pk AND begins_with (sk, :sk)"
        : "pk = :pk",
      ExpressionAttributeValues: skType
        ? {
            ":pk": { S: pk },
            ":sk": { S: skType },
          }
        : {
            ":pk": { S: pk },
          },
      Select: "COUNT",
    };

    const countRes = await dynamodb.send(new QueryCommand(countParams));
    const countActual = countRes?.Count;
    logger.debug(`The actual count of items is: ${countActual}`);

    // Compare the actualCount to the counter's counterValue. If the countActual is
    // higher, then the counter could provide an ID that already exists (collision),
    // or provide an ID that already existed but was deleted (replacement - avoid this too).
    // Initiate the reset and retry. If countCurrent 0, counter might have been deleted so
    // reset anyway.
    if (countCurrent === 0 || countActual > countCurrent) {
      logger.debug(`countActual: ${countActual}`);
      logger.debug(`countCurrent: ${countCurrent}`);
      // attempt to reset the counter
      await resetCounter(pk, skType);

      // Then run it back
      return await incrementCounter(pk, collectionType);
    } else {

      // Attempt to increment the counter's value. If it doesn't exist the this creates it.
      const incrementParams = {
        TableName: COUNTER_TABLE_NAME,
        Key: {
          pk: { S: `counter::${pk}${skType ? "::" + skType : ""}` },
        },
        UpdateExpression: "ADD counterValue :counterValue",
        ExpressionAttributeValues: {
          ":counterValue": { N: 1 },
        },
        ReturnValues: "ALL_NEW",
      };

      const incrementRes = await dynamodb.send(
        new UpdateItemCommand(incrementParams)
      );
      const newCounterValue = unmarshall(incrementRes?.Attributes);
      const nextId = newCounterValue.counterValue;
      logger.debug(`new counterValue incremented to: ${nextId}`);

      return nextId;
    }
  } catch (error) {
    logger.error("Error with incrementCounter: ", error);
  }
}

/**
 * Reset's an item's counter in counter table. Queries the existing items using
 *  the pk and partial sk, maps and finds what the next logical ID should be.
 * 
 * @param {string} pk - pk of the item
 * @param {string} sk - concatenated string with sk's collection types, without
 *                      their identifier, e.g. "structure" or "foo::bar" etc.
 * 
 * @returns {void} Resets the counter value, throws error otherwise.
 */
async function resetCounter(pk, skType) {
  try {
    // If skType exists, we want to search with begins_with, otherwise we
    // are just searching with the pk.
    const identifierQuery = {
      TableName: TABLE_NAME,
      KeyConditionExpression: skType
        ? "pk = :pk AND begins_with (sk, :sk)"
        : "pk = :pk",
      ExpressionAttributeValues: skType
        ? {
            ":pk": { S: pk },
            ":sk": { S: skType },
        }
        : {
            ":pk": { S: pk },
        },
      ProjectionExpression: "identifier",
    };
    logger.debug(`identifierQuery: ${identifierQuery}`);

    // Through all the items pulled, just find the highest identifier
    const res = await runQuery(identifierQuery, null, null, false); // no pagination, return all
    const items = res.items || [];
    const identifiers = items.map(item => Number(item.identifier || 0));
    const maxIdentifier = identifiers.length > 0 ? Math.max(...identifiers) : 0;
    logger.debug(`Max identifier found: ${maxIdentifier}`);

    // The we set the counter to the max identifier to be the initial value
    const counterParams = {
      TableName: COUNTER_TABLE_NAME,
      Key: {
          pk: { S: `counter::${pk}${skType ? '::' + skType : ''}` },
      },
      UpdateExpression: "SET counterValue = :initialValue",
      ExpressionAttributeValues: {
          ":initialValue": { N: maxIdentifier },
      },
      ReturnValues: "ALL_NEW",
    };
    logger.debug(`Resetting counter with max identifier: ${counterParams}`);

    await dynamodb.send(new UpdateItemCommand(counterParams));
  } catch (error) {
    logger.error("Error with resetCounter: ", error)
  }
}

async function runQuery(query, limit = null, lastEvaluatedKey = null, paginated = true) {
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

async function deleteItem(pk, sk, tableName = TABLE_NAME) {
  logger.info(`deleteItem: { pk: ${pk}, sk: ${sk} }`);
  const params = {
    TableName: tableName,
    Key: marshall({ pk, sk }),
    ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
  };
  try {
    await dynamodbClient.send(new DeleteItemCommand(params));
    logger.info(`Item with pk: ${pk} and sk: ${sk} deleted successfully.`);
  } catch (error) {
    logger.error(`Error deleting item with pk: ${pk} and sk: ${sk}:`, error);
    throw error;
  }
}

async function putItem(obj, tableName = TABLE_NAME) {
  let putObj = {
    TableName: tableName,
    Item: obj,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
  };

  logger.debug("Putting putObj:", putObj);
  await dynamodb.putItem(putObj);
}

/**
 * Retrieves data from DynamoDB in parallel using batch get requests. Fires off multiple async requests to DynamoDB, but waits for all to complete before returning.
 *
 * @param {Object} groups - An object where each key represents a group of data and its value is an array of pk/sk keys to fetch.
 * @param {string} tableName - The name of the DynamoDB table to query.
 * @returns {Object} An object where each key is a group of results from the batch get requests.
 */
async function parallelizedBatchGetData(groups, tableName) {
  // create array from groups
  const keys = Object.keys(groups);
  const promises = await Promise.all(keys.map(key => batchGetDataPromise(key, groups[key], tableName)));
  return promises;
}

/**
 * Retrieves a batch of items from a DynamoDB table.
 *
 * @param {Array} keys - An array of keys to retrieve from the table.
 * @param {string} tableName - The name of the DynamoDB table.
 * @returns {Object} An array of items retrieved from the table.
 */
async function batchGetData(keys, tableName) {
  const res = await batchGetDataPromise('batch', keys, tableName);
  return res?.data;
}

function batchGetDataPromise(groupName, keys, tableName) {
  return new Promise((resolve, reject) => {
    let data = [];
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
        if (res?.UnprocessedKeys?.[tableName]?.Keys) {
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
  PUBSUB_TABLE_NAME,
  PutItemCommand,
  QueryCommand,
  TABLE_NAME,
  USER_ID_PARTITION,
  batchGetData,
  batchGetDataPromise,
  batchTransactData,
  batchWriteData,
  deleteItem,
  dynamodb,
  dynamodbClient,
  getOne,
  incrementCounter,
  marshall,
  parallelizedBatchGetData,
  putItem,
  runQuery,
  runScan,
  unmarshall,
};
