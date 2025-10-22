const { BatchGetItemCommand, DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand, DeleteItemCommand, UpdateItemCommand, BatchWriteItemCommand, TransactWriteItemsCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { logger } = require('/opt/base');


const REFERENCE_DATA_TABLE_NAME = process.env.REFERENCE_DATA_TABLE_NAME || 'reference-data';
const GLOBALID_INDEX_NAME = 'globalId-index';
const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE_NAME || 'audit';
const PUBSUB_TABLE_NAME = process.env.PUBSUB_TABLE_NAME || 'pubsub';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const USER_ID_PARTITION = 'userid';
const TRANSACTION_MAX_SIZE = 100;

const options = {
  region: AWS_REGION,
};

if (process.env?.IS_OFFLINE === 'true') {
  options.endpoint = DYNAMODB_ENDPOINT_URL;
  // Add dummy credentials for local development
  options.credentials = {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy'
  };
}

// Lazy initialization of DynamoDB clients
let dynamodb;
let dynamodbClient;

function getDynamoDBClient() {
  if (!dynamodbClient) {
    dynamodbClient = new DynamoDBClient(options);
  }
  return dynamodbClient;
}

// simple way to return a single Item by primary key.
async function getOne(pk, sk, tableName = REFERENCE_DATA_TABLE_NAME) {
  logger.info(`getItem: { pk: ${pk}, sk: ${sk} }`);
  const params = {
    TableName: tableName,
    Key: marshall({ pk, sk }),
  };
  let item = await getDynamoDBClient().send(new GetItemCommand(params));
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
    skType = collectionType.join('::');
  }

  try {
    // Get current counter value. Built using pk and partial sk.
    const getCounterParams = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: {
        pk: { S: `${pk}${skType ? "::" + skType : ""}` },
        sk: { S: `counter` },
      },
    };

    const getRes = await getDynamoDBClient().send(new GetItemCommand(getCounterParams));

    // If we don't return an Item, it means there's no counter to begin with
    // Track whether the counter was missing and set counter to 0
    const counterItemMissing = !getRes?.Item;
    let item;

    if (counterItemMissing) {
      item = { counterValue: 0 };
      logger.debug("No counter found — defaulting to 0");
    } else {
      item = unmarshall(getRes.Item);
    }

    const countCurrent = item?.counterValue;
    logger.debug(`Counter's current value is: ${countCurrent}`);

    // Check what this item's actual count on the main table is, or if this
    // item even exists.
    const countParams = {
      TableName: REFERENCE_DATA_TABLE_NAME,
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

    const countRes = await getDynamoDBClient().send(new QueryCommand(countParams));
    let countActual = countRes?.Count;

    // If no skType, we need to exclude the counter item from the count
    if (!skType && countActual > 0) {
      countActual = countActual - 1;
    }

    logger.debug(`The actual count of items is: ${countActual}`);

    // Compare the actualCount to the counter's counterValue. If the countActual is
    // higher, then the counter could provide an ID that already exists (collision),
    // or provide an ID that already existed but was deleted (replacement - avoid this too).
    // Initiate the reset and retry. If counterItemMissing is true, counter was deleted so
    // reset anyway.
    if (counterItemMissing || countActual > countCurrent) {
      logger.debug(`counterItemMissing: ${counterItemMissing}`);
      logger.debug(`countActual: ${countActual}`);
      logger.debug(`countCurrent: ${countCurrent}`);
      // attempt to reset the counter
      await resetCounter(pk, skType);

      // Then run it back
      return await incrementCounter(pk, collectionType);
    } else {

      // Attempt to increment the counter's value. If it doesn't exist the this creates it.
      const incrementParams = {
        TableName: REFERENCE_DATA_TABLE_NAME,
        Key: {
          pk: { S: `${pk}${skType ? "::" + skType : ""}` },
          sk: { S: `counter` },
        },
        UpdateExpression: "ADD counterValue :counterValue",
        ExpressionAttributeValues: {
          ":counterValue": { N: "1" },
        },
        ReturnValues: "ALL_NEW",
      };

      const incrementRes = await getDynamoDBClient().send(
        new UpdateItemCommand(incrementParams)
      );
      const newCounterValue = unmarshall(incrementRes?.Attributes);
      const nextId = newCounterValue.counterValue;
      logger.debug(`new counterValue incremented to: ${nextId}`);

      return nextId;
    }
  } catch (error) {
    logger.error("Error with incrementCounter: ", error);
    throw error;
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
      TableName: REFERENCE_DATA_TABLE_NAME,
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
    let items = res.items || [];

    // If no skType, filter out the counter item manually
    if (!skType) {
      items = items.filter(item => item.sk !== 'counter');
    }

    const identifiers = items.map(item => Number(item.identifier || 0));
    const maxIdentifier = identifiers.length > 0 ? Math.max(...identifiers) : 0;
    logger.debug(`Max identifier found: ${maxIdentifier}`);

    // The we set the counter to the max identifier to be the initial value
    const counterParams = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: {
        pk: { S: `${pk}${skType ? '::' + skType : ''}` },
        sk: { S: `counter` }
      },
      UpdateExpression: "SET counterValue = :initialValue",
      ExpressionAttributeValues: {
        ":initialValue": { N: `${maxIdentifier}` },
      },
      ReturnValues: "ALL_NEW",
    };
    logger.debug(`Resetting counter with max identifier: ${counterParams}`);

    await getDynamoDBClient().send(new UpdateItemCommand(counterParams));
  } catch (error) {
    logger.error("Error with resetCounter: ", error);
    throw error;
  }
}
async function getOneByGlobalId(globalId, globalIdAttributeName = 'globalId', tableName = REFERENCE_DATA_TABLE_NAME, indexName = GLOBALID_INDEX_NAME) {
  logger.info(`getItem by index: { ${globalIdAttributeName}: ${globalId}, indexName: ${indexName} }`);

  // GetItem operation is not supported on GSIs, so we need to use Query instead.
  const params = {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: '#globalId = :globalId',
    ExpressionAttributeValues: {
      ':globalId': marshall(globalId),
    },
    ExpressionAttributeNames: {
      '#globalId': globalIdAttributeName,
    }
  };

  let item = await runQuery(params);
  if (item?.items?.[0]) {
    return item.items[0];
  }
  return null;
}

/*
 * Generic function to get items by a GSI with optional sort key condition.
 * @param {string} gsiName - The name of the GSI partition key attribute.
 * @param {string} gsiValue - The value of the GSI partition key to query.
 * @param {string} tableName - The name of the DynamoDB table (default is REFERENCE_DATA_TABLE_NAME).
 * @param {string} indexName - The name of the GSI index to use.
 * @param {object} sortKeyCondition.operator: 'begins_with'|'='|'<','<='|'>'|'>='|'between'
 * @param {object} sortKeyCondition.value: string|number|object (for between: {start: val1, end: val2})
 * @param {object} sortKeyCondition.attributeName: string (optional, defaults to 'sk')
 *
 * @returns {Array} Array of items matching the GSI query and optional sort key condition.
 */

async function getByGSI(gsiName, gsiValue, tableName = REFERENCE_DATA_TABLE_NAME, indexName, sortKeyCondition = null) {
  console.log(`getItem by index: { ${gsiName}: ${gsiValue}, indexName: ${indexName}, sortKeyCondition: ${JSON.stringify(sortKeyCondition)} }`);

  let keyConditionExpression = `#${gsiName} = :${gsiName}`;
  const expressionAttributeValues = {
    [':' + gsiName]: marshall(gsiValue),
  };
  const expressionAttributeNames = {
    ['#' + gsiName]: gsiName,
  };

  // If sort key condition is provided, add it to the query
  if (sortKeyCondition) {
    const { operator, value, attributeName = 'sk' } = sortKeyCondition;

    switch (operator) {
      case '=':
      case 'equals':
        keyConditionExpression += ` AND #${attributeName} = :${attributeName}`;
        expressionAttributeValues[`:${attributeName}`] = marshall(value);
        break;
      case 'begins_with':
        keyConditionExpression += ` AND begins_with(#${attributeName}, :${attributeName})`;
        expressionAttributeValues[`:${attributeName}`] = marshall(value);
        break;
      case '<':
      case 'lessThan':
        keyConditionExpression += ` AND #${attributeName} < :${attributeName}`;
        expressionAttributeValues[`:${attributeName}`] = marshall(value);
        break;
      case '<=':
      case 'lessThanOrEqual':
        keyConditionExpression += ` AND #${attributeName} <= :${attributeName}`;
        expressionAttributeValues[`:${attributeName}`] = marshall(value);
        break;
      case '>':
      case 'greaterThan':
        keyConditionExpression += ` AND #${attributeName} > :${attributeName}`;
        expressionAttributeValues[`:${attributeName}`] = marshall(value);
        break;
      case '>=':
      case 'greaterThanOrEqual':
        keyConditionExpression += ` AND #${attributeName} >= :${attributeName}`;
        expressionAttributeValues[`:${attributeName}`] = marshall(value);
        break;
      case 'between':
        keyConditionExpression += ` AND #${attributeName} BETWEEN :${attributeName}Start AND :${attributeName}End`;
        expressionAttributeValues[`:${attributeName}Start`] = marshall(value.start);
        expressionAttributeValues[`:${attributeName}End`] = marshall(value.end);
        break;
      default:
        throw new Error(`Unsupported sort key operator: ${operator}`);
    }

    expressionAttributeNames[`#${attributeName}`] = attributeName;
  }

  // Build the query parameters
  const params = {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
  };

  const item = await runQuery(params);
  return item?.items ?? [];
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
    pageData = await getDynamoDBClient().send(new QueryCommand(query));
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
    pageData = await getDynamoDBClient().scan(query);
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

async function deleteItem(pk, sk, tableName = REFERENCE_DATA_TABLE_NAME) {
  logger.info(`deleteItem: { pk: ${pk}, sk: ${sk} }`);
  const params = {
    TableName: tableName,
    Key: marshall({ pk, sk }),
    ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
  };
  try {
    await getDynamoDBClient().send(new DeleteItemCommand(params));
    logger.info(`Item with pk: ${pk} and sk: ${sk} deleted successfully.`);
  } catch (error) {
    logger.error(`Error deleting item with pk: ${pk} and sk: ${sk}:`, error);
    throw error;
  }
}

async function putItem(obj, tableName = REFERENCE_DATA_TABLE_NAME) {
  let putObj = {
    TableName: tableName,
    Item: obj,
    ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
  };

  logger.debug("Putting putObj:", putObj);
  await getDynamoDBClient().putItem(putObj);
}

/**
 * Retrieves data from DynamoDB in parallel using batch get requests. Fires off multiple async requests to DynamoDB, but waits for all to complete before returning.
 *
 * @param {Object} groups - An object where each key represents a group of data and its value is an array of pk/sk keys to fetch.
 * @param {string} tableName - The name of the DynamoDB table to query.
 * @returns {Object} An object where each key is a group of results from the batch get requests.
 */
async function parallelizedBatchGetData(groups, tableName = REFERENCE_DATA_TABLE_NAME) {
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
async function batchGetData(keys, tableName = REFERENCE_DATA_TABLE_NAME) {
  const res = await batchGetDataPromise('batch', keys, tableName);
  return res?.data;
}

function batchGetDataPromise(groupName, keys, tableName = REFERENCE_DATA_TABLE_NAME) {
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
    getDynamoDBClient().send(command, (err, res) => {
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


async function batchWriteData(dataToInsert, chunkSize, tableName = REFERENCE_DATA_TABLE_NAME) {
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
      const command = new BatchWriteItemCommand(params);
      const data = await getDynamoDBClient().send(command);
      logger.info(`BatchWriteItem response for chunk ${index}:`, data);
    } catch (err) {
      console.log('err:', err);
      throw new Error(`Error batch writing items in chunk ${index}: ${err}`);
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

      const data = await getDynamoDBClient().send(
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
  GLOBALID_INDEX_NAME,
  PUBSUB_TABLE_NAME,
  ScanCommand,
  UpdateItemCommand,
  PutItemCommand,
  QueryCommand,
  REFERENCE_DATA_TABLE_NAME,
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
  getOneByGlobalId,
  getByGSI,
  marshall,
  parallelizedBatchGetData,
  putItem,
  runQuery,
  runScan,
  unmarshall,
};
